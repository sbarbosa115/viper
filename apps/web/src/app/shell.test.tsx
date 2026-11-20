import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { json, meFixture, mockMe, renderApp, setViewport } from './test-utils';

afterEach(() => {
  setViewport(false);
  vi.unstubAllGlobals();
});

const staff = { isStaff: true, twoFactor: { required: true, passed: true, setUp: true } };

describe('app: customer shell', () => {
  test('rail shows Chat, Plans, Leads, Credits and the logo links to the landing page', async () => {
    mockMe(meFixture());
    renderApp('/plans');
    const rail = await screen.findByRole('navigation', { name: 'Main navigation' });
    for (const name of ['Chat', 'Plans', 'Leads', 'Credits']) {
      expect(within(rail).getByRole('link', { name })).toBeInTheDocument();
    }
    expect(within(rail).getByRole('link', { name: 'Plans' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(rail).getByRole('link', { name: 'Llyner Leads home' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  test('the Staff rail item is hidden for non-Staff and shown for Staff', async () => {
    mockMe(meFixture());
    renderApp('/plans');
    await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(screen.queryByRole('link', { name: 'Back office' })).not.toBeInTheDocument();
  });

  test('Staff see the Back office item', async () => {
    mockMe(meFixture(staff));
    renderApp('/plans');
    expect(await screen.findByRole('link', { name: 'Back office' })).toHaveAttribute(
      'href',
      '/staff',
    );
  });

  test('the header shows the breadcrumb and the mono credit balance linking to credits', async () => {
    mockMe(meFixture());
    renderApp('/plans/new');
    const pill = await screen.findByRole('link', { name: /Credits: 214 cr/ });
    expect(pill).toHaveAttribute('href', '/credits');
    expect(pill).toHaveClass('font-mono');
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(crumbs).toHaveTextContent('Sweet Co/Plans/New plan');
  });

  test('account menu: business, profile, legal links as full page loads, log out', async () => {
    mockMe(meFixture());
    renderApp('/plans');
    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Sweet Co')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Profile' })).toBeInTheDocument();
    for (const [name, href] of [
      ['Terms of service', '/terms'],
      ['Privacy policy', '/privacy'],
      ['Acceptable use', '/acceptable-use'],
      ['Cookies', '/cookies'],
    ] as const) {
      expect(within(menu).getByRole('menuitem', { name })).toHaveAttribute('href', href);
    }
    expect(within(menu).getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument();
    expect(
      within(menu).queryByRole('menuitem', { name: /Stop acting as/ }),
    ).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  test('"Stop acting as" shows only while Acting as and returns to Customers', async () => {
    mockMe(
      meFixture({
        ...staff,
        actingAs: {
          businessId: '0192f3a0-0000-7000-8000-000000000009',
          businessName: 'Acme Bakery',
        },
      }),
      {
        'DELETE /api/staff/acting-as': () => json(meFixture(staff)),
      },
    );
    const router = renderApp('/plans');
    expect(await screen.findByText('Acting as Acme Bakery')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Stop acting as Acme Bakery' }));
    await screen.findByRole('heading', { name: 'Customers' });
    expect(router.state.location.pathname).toBe('/staff/customers');
  });

  test('mobile: top bar and a bottom tab bar replace the rail', async () => {
    setViewport(true);
    mockMe(meFixture());
    renderApp('/credits');
    const tabs = await screen.findByRole('navigation', { name: 'Main tabs' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Chat', 'Plans', 'Leads', 'Credits']);
    expect(within(tabs).getByRole('link', { name: 'Credits' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
  });
});

describe('app: staff shell', () => {
  test('desktop nav lists every back office section with the STAFF badge', async () => {
    mockMe(meFixture(staff));
    renderApp('/staff');
    const nav = await screen.findByRole('navigation', { name: 'Back office navigation' });
    for (const name of [
      'Dashboard',
      'Customers',
      'Runs',
      'Research flows',
      'Tools & Rate card',
      'Credit packs',
      'Settings',
      'Audit log',
      'Back to my account',
    ]) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    }
    expect(within(nav).getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    expect(screen.getByText('STAFF')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('mobile: the menu button opens the nav', async () => {
    setViewport(true);
    mockMe(meFixture(staff));
    renderApp('/staff');
    const button = await screen.findByRole('button', { name: 'Open menu' });
    expect(
      screen.queryByRole('navigation', { name: 'Back office navigation' }),
    ).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(screen.getByRole('navigation', { name: 'Back office navigation' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Customers' }));
    expect(
      screen.queryByRole('navigation', { name: 'Back office navigation' }),
    ).not.toBeInTheDocument();
  });
});
