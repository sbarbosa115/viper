import { remainingPlaceholders } from './router';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { meFixture, mockMe, renderApp, setViewport } from './test-utils';

afterEach(() => {
  setViewport(false);
  vi.unstubAllGlobals();
});

function samplePath(path: string) {
  return `/${path.replace(':id', '0192f3a0-0000-7000-8000-0000000000aa')}`;
}

describe('app: router', () => {
  test('the sign-in routes show the product name as the page heading', async () => {
    mockMe(null);
    renderApp('/login');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Llyner Leads' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  test('unknown routes show Page not found with a link home', async () => {
    mockMe(meFixture());
    renderApp('/nope/at/all');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go home' })).toBeInTheDocument();
  });

  test('FR-0c: the dev kit page lists the components', () => {
    mockMe(null);
    renderApp('/__kit');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('UI kit');
  });

  test.each(remainingPlaceholders().map((p) => [p.path || '(index)', p] as const))(
    'every section 6b route renders a placeholder: %s',
    async (_name, p) => {
      const me = meFixture({
        isStaff: true,
        twoFactor: { required: true, passed: true, setUp: true },
      });
      mockMe(p.group === 'auth' || p.group === 'guest-auth' ? null : me);
      renderApp(samplePath(p.path));
      expect(await screen.findByText(/^Coming in wave \d$/)).toBeInTheDocument();
    },
  );
});
