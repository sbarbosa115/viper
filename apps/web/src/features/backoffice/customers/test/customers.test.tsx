import { customer as example } from '@app/contracts/examples';
import type { Customer } from '@app/contracts/reporting';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, test } from 'vitest';
import { meQueryKey } from '../../../../shared/api/me';
import { server } from '../../../../test/setup';
import { customerIds, customersState, handlers, resetCustomersState } from './handlers';
import { renderCustomers } from './render';

beforeEach(() => {
  resetCustomersState();
  server.use(...handlers);
});

const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(name) });

describe('FR-31: customer list', () => {
  test('lists customers with the agreed columns, "—" for never active', async () => {
    renderCustomers();
    expect(await screen.findByRole('heading', { level: 1, name: 'Customers' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Customers' });
    for (const h of [
      'Business',
      'Owner email',
      'Signed up',
      'Verified',
      'Available',
      'Runs',
      'Leads',
      'Last active',
      'Paying',
    ]) {
      expect(within(table).getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    const sweet = within(rowOf('Sweet Supply Co'));
    expect(sweet.getByText('863')).toBeInTheDocument();
    expect(sweet.getByText('owner@demo.test')).toBeInTheDocument();
    const clean = within(rowOf('Clean Desk Co'));
    expect(clean.getAllByText('○ no')).toHaveLength(2);
    expect(clean.getAllByText('—').length).toBeGreaterThan(0);
  });

  test('AC: search "bakery" shows only matching businesses', async () => {
    const user = userEvent.setup();
    renderCustomers();
    await screen.findByRole('table', { name: 'Customers' });
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'bakery');
    await waitFor(() => expect(screen.queryByText('Clean Desk Co')).not.toBeInTheDocument());
    expect(screen.getByText('Corner Bakery Supply')).toBeInTheDocument();
    expect(customersState.queries.at(-1)).toMatchObject({ q: 'bakery' });
  });

  test('shows a no-results state for a search with no match', async () => {
    const user = userEvent.setup();
    renderCustomers();
    await screen.findByRole('table', { name: 'Customers' });
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'zzz');
    expect(await screen.findByText('No results')).toBeInTheDocument();
    expect(screen.getByText(/No business or owner email matches/)).toBeInTheDocument();
  });

  test('sorts by last active', async () => {
    const user = userEvent.setup();
    renderCustomers();
    await screen.findByRole('table', { name: 'Customers' });
    await user.selectOptions(screen.getByLabelText('Sort by'), 'lastActive');
    await waitFor(() =>
      expect(customersState.queries.at(-1)).toMatchObject({ sort: 'lastActive' }),
    );
    const names = (await screen.findAllByRole('row')).slice(1).map((r) => r.textContent ?? '');
    expect(names[0]).toContain('Sweet Supply Co');
  });

  test('pages with a cursor, 50 at a time', async () => {
    const user = userEvent.setup();
    customersState.customers = Array.from({ length: 60 }, (_, i): Customer => ({
      ...example,
      id: `0193a1b2-0000-7000-8000-${String(i + 500).padStart(12, '0')}`,
      name: `Biz ${String(i).padStart(2, '0')}`,
      signedUpAt: new Date(Date.UTC(2026, 9, 1, 0, 60 - i)).toISOString(),
    }));
    renderCustomers();
    await screen.findByRole('table', { name: 'Customers' });
    expect(screen.getAllByRole('row')).toHaveLength(51);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(61));
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(customersState.queries.at(-1)).toMatchObject({ cursor: '50' });
  });

  test('shows an error with retry', async () => {
    server.use(
      http.get('*/api/staff/businesses', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }),
      ),
    );
    renderCustomers();
    expect(await screen.findByText('Customers did not load')).toBeInTheDocument();
  });
});

describe('FR-6: Act as', () => {
  test('Act as starts it, stores the new me and opens /plans as that business', async () => {
    const user = userEvent.setup();
    const { router, client } = renderCustomers();
    await screen.findByRole('table', { name: 'Customers' });
    await user.click(screen.getByRole('button', { name: 'Act as Corner Bakery Supply' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/plans'));
    expect(customersState.actedAs).toEqual([customerIds.bakery]);
    expect(
      client.getQueryData<{ actingAs: { businessName: string } }>(meQueryKey)?.actingAs,
    ).toEqual({
      businessId: customerIds.bakery,
      businessName: 'Corner Bakery Supply',
    });
  });

  test('a failed Act as stays on the list with a message', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/api/staff/acting-as', () =>
        HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'x' } }, { status: 404 }),
      ),
    );
    const { router } = renderCustomers();
    await screen.findByRole('table', { name: 'Customers' });
    await user.click(screen.getByRole('button', { name: 'Act as Clean Desk Co' }));
    expect(await screen.findByText(/Could not start Acting as/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/staff/customers');
  });
});

describe('FR-13: grant credits', () => {
  async function openGrant(name: string) {
    const user = userEvent.setup();
    renderCustomers();
    await screen.findByRole('table', { name: 'Customers' });
    await user.click(screen.getByRole('button', { name: `Grant credits ${name}` }));
    const dialog = await screen.findByRole('dialog', { name: `Grant credits to ${name}` });
    return { user, dialog: within(dialog) };
  }

  test('requires a non-zero whole number and a reason', async () => {
    const { user, dialog } = await openGrant('Sweet Supply Co');
    await user.click(dialog.getByRole('button', { name: 'Grant' }));
    expect(dialog.getByText('Enter a whole number')).toBeInTheDocument();
    expect(dialog.getByText('Enter a reason')).toBeInTheDocument();
    await user.type(dialog.getByLabelText('Credits'), '0');
    await user.type(dialog.getByLabelText('Reason'), 'x');
    await user.click(dialog.getByRole('button', { name: 'Grant' }));
    expect(dialog.getByText('Enter a number other than 0')).toBeInTheDocument();
    expect(customersState.grants).toEqual([]);
  });

  test('grants credits with a reason, closes and confirms', async () => {
    const { user, dialog } = await openGrant('Sweet Supply Co');
    await user.type(dialog.getByLabelText('Credits'), '1000');
    await user.type(dialog.getByLabelText('Reason'), 'beta tester');
    await user.click(dialog.getByRole('button', { name: 'Grant' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(customersState.grants).toEqual([
      { id: customerIds.example, credits: 1000, reason: 'beta tester' },
    ]);
    expect(screen.getByText('Granted 1000 credits to Sweet Supply Co.')).toBeInTheDocument();
  });

  test('a removal that would go below 0 (422) shows the message in the dialog', async () => {
    customersState.grantError = 'below-zero';
    const { user, dialog } = await openGrant('Clean Desk Co');
    await user.type(dialog.getByLabelText('Credits'), '-50');
    await user.type(dialog.getByLabelText('Reason'), 'correction');
    await user.click(dialog.getByRole('button', { name: 'Grant' }));
    expect(
      await dialog.findByText('That would take the balance below 0 credits.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('closes on Cancel without a request', async () => {
    const { user, dialog } = await openGrant('Sweet Supply Co');
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(customersState.grants).toEqual([]);
  });
});

describe('FR-31: mark internal', () => {
  test('marks a business internal, shows the badge, and can undo it', async () => {
    const user = userEvent.setup();
    renderCustomers();
    await screen.findByRole('table', { name: 'Customers' });
    await user.click(screen.getByRole('button', { name: 'Mark internal Clean Desk Co' }));
    await waitFor(() =>
      expect(within(rowOf('Clean Desk Co')).getByText('Internal')).toBeInTheDocument(),
    );
    expect(customersState.patches).toEqual([{ id: customerIds.clean, internal: true }]);
    await user.click(screen.getByRole('button', { name: 'Remove internal Clean Desk Co' }));
    await waitFor(() =>
      expect(within(rowOf('Clean Desk Co')).queryByText('Internal')).not.toBeInTheDocument(),
    );
    expect(customersState.patches.at(-1)).toEqual({ id: customerIds.clean, internal: false });
  });

  test('a failed update shows a message', async () => {
    const user = userEvent.setup();
    server.use(
      http.patch('*/api/staff/businesses/:id', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }),
      ),
    );
    renderCustomers();
    await screen.findByRole('table', { name: 'Customers' });
    await user.click(screen.getByRole('button', { name: 'Mark internal Clean Desk Co' }));
    expect(
      await screen.findByText('Could not update that business. Try again.'),
    ).toBeInTheDocument();
  });
});
