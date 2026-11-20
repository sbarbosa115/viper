import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ToastProvider } from '../shared/ui';
import { routes } from './router';

export function meFixture(
  overrides: {
    isStaff?: boolean;
    twoFactor?: { required: boolean; passed: boolean; setUp: boolean };
    actingAs?: { businessId: string; businessName: string } | null;
  } = {},
) {
  return {
    member: {
      id: '0192f3a0-0000-7000-8000-000000000001',
      name: 'Dana Owner',
      email: 'dana@example.com',
      emailVerified: true,
      isStaff: overrides.isStaff ?? false,
    },
    business: { id: '0192f3a0-0000-7000-8000-000000000002', name: 'Sweet Co' },
    actingAs: overrides.actingAs ?? null,
    twoFactor: overrides.twoFactor ?? { required: false, passed: false, setUp: false },
  };
}

type Handler = (init?: RequestInit) => Response;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Answers fetch calls by "METHOD /api/path"; anything else fails the test loudly. Undo with vi.unstubAllGlobals(). */
export function stubApi(handlers: Record<string, Handler>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${typeof input === 'string' ? input : '(non-string url)'}`;
      const handler = handlers[key];
      return handler
        ? Promise.resolve(handler(init))
        : Promise.reject(new Error(`Unexpected request: ${key}`));
    }),
  );
}

/** `null` answers 401 (signed out). Extra handlers are merged in. */
export function mockMe(
  me: ReturnType<typeof meFixture> | null,
  extra: Record<string, Handler> = {},
) {
  stubApi({
    'GET /api/auth/me': () =>
      me ? json(me) : json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }, 401),
    'GET /api/credits': () =>
      json({ balance: 214, reserved: 0, available: 214, packs: [], paymentsAvailable: true }),
    ...extra,
  });
}

export { json };

export function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return router;
}

export function setViewport(mobile: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: mobile,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}
