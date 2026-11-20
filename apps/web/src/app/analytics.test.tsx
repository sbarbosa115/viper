import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { GTAG_SRC } from '../shared/analytics/ga';
import { GoogleAnalytics } from './analytics';
import { meFixture, stubApi } from './test-utils';

type GaWindow = Window & { dataLayer?: IArguments[]; gtag?: unknown };
const w = window as GaWindow;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const config = (gaMeasurementId: string | null) => ({
  gaMeasurementId,
  supportEmail: null,
  youtubeVideoId: null,
});
const signedOut = () => json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }, 401);

function setup(start: string, gaId: string | null, me: ReturnType<typeof meFixture> | null) {
  stubApi({
    'GET /api/public/config': () => json(config(gaId)),
    'GET /api/auth/me': () => (me ? json(me) : signedOut()),
  });
  const router = createMemoryRouter([{ path: '*', element: null }], {
    basename: '/app',
    initialEntries: [start],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GoogleAnalytics router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const scripts = () => document.head.querySelectorAll(`script[src^="${GTAG_SRC}"]`);
const pageViews = () =>
  (w.dataLayer ?? [])
    .map((args) => Array.from<unknown>(args))
    .filter(([kind, name]) => kind === 'event' && name === 'page_view')
    .map(([, , params]) => (params as { page_path: string }).page_path);
const requested = () =>
  vi.mocked(fetch).mock.calls.map(([input]) => (typeof input === 'string' ? input : '?'));

afterEach(() => {
  vi.unstubAllGlobals();
  for (const s of Array.from(scripts())) s.remove();
  delete w.dataLayer;
  delete w.gtag;
});

describe('FR-9: GA page views in the SPA', () => {
  test('no measurement ID: nothing loads and nothing is sent', async () => {
    setup('/app/plans', null, meFixture());
    await waitFor(() => expect(requested()).toContain('/api/public/config'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(scripts()).toHaveLength(0);
    expect(w.dataLayer).toBeUndefined();
    expect(requested().some((url) => url.includes('googletagmanager'))).toBe(false);
  });

  test('a page_view with the path only on start and on every navigation, gtag loaded once', async () => {
    const router = setup('/app/plans?tab=x', 'G-ABC1234', meFixture());
    await waitFor(() => expect(pageViews()).toEqual(['/app/plans']));
    await act(() => router.navigate('/leads/42?next=%2Fsecret'));
    await act(() => router.navigate('/credits#top'));
    await waitFor(() =>
      expect(pageViews()).toEqual(['/app/plans', '/app/leads/42', '/app/credits']),
    );
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]?.getAttribute('src')).toBe(`${GTAG_SRC}?id=G-ABC1234`);
  });

  test('tokens in the query string and personal data never reach GA', async () => {
    const router = setup('/app/verify-email?token=s3cr3t-token', 'G-ABC1234', null);
    await waitFor(() => expect(pageViews()).toEqual(['/app/verify-email']));
    await act(() => router.navigate('/reset-password?token=r3set&code=123456&next=%2Fplans'));
    await act(() => router.navigate('/plans'));
    await waitFor(() => expect(pageViews()).toHaveLength(3));
    const sent = JSON.stringify((w.dataLayer ?? []).map((args) => Array.from<unknown>(args)));
    for (const leak of ['s3cr3t', 'r3set', '123456', 'next', 'dana@example.com', 'Dana Owner']) {
      expect(sent).not.toContain(leak);
    }
  });

  test('back-office routes are not tracked', async () => {
    const router = setup('/app/staff/settings', 'G-ABC1234', meFixture({ isStaff: true }));
    await waitFor(() => expect(requested()).toContain('/api/auth/me'));
    await act(() => router.navigate('/staff/runs'));
    await act(() => router.navigate('/plans'));
    await waitFor(() => expect(pageViews()).toEqual(['/app/plans']));
  });

  test('Acting-as sessions are not tracked', async () => {
    const actingAs = { businessId: '0192f3a0-0000-7000-8000-000000000009', businessName: 'Acme' };
    const router = setup('/app/plans', 'G-ABC1234', meFixture({ isStaff: true, actingAs }));
    await waitFor(() => expect(requested()).toContain('/api/auth/me'));
    await act(() => router.navigate('/leads'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pageViews()).toEqual([]);
    expect(scripts()).toHaveLength(0);
  });
});
