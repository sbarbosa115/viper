import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { meFixture, mockMe, renderApp } from './test-utils';

afterEach(() => vi.unstubAllGlobals());

describe('app: route guards', () => {
  test('signed out: redirects to login keeping the return path', async () => {
    mockMe(null);
    const router = renderApp('/plans/abc?tab=x');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/plans/abc?tab=x')}`);
  });

  test('signed in on login goes home', async () => {
    mockMe(meFixture());
    const router = renderApp('/login');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();
  });

  test('Staff without a passed code is sent to two-factor', async () => {
    mockMe(meFixture({ isStaff: true, twoFactor: { required: true, passed: false, setUp: true } }));
    const router = renderApp('/staff/runs');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login/two-factor'));
  });

  test('non-Staff on /staff sees Page not found', async () => {
    mockMe(meFixture());
    renderApp('/staff/customers');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  test('Staff with two-factor passed reaches the back office', async () => {
    mockMe(meFixture({ isStaff: true, twoFactor: { required: true, passed: true, setUp: true } }));
    renderApp('/staff/customers');
    expect(await screen.findByRole('heading', { name: 'Customers' })).toBeInTheDocument();
  });
});
