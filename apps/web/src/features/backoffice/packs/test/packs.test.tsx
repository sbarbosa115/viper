import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, test } from 'vitest';
import { server } from '../../../../test/setup';
import { handlers, packsState, resetPacksState } from './handlers';
import { renderPacks } from './render';

beforeEach(() => {
  resetPacksState();
  server.use(...handlers);
});

const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(name) });

describe('FR-13: credit packs', () => {
  test('lists packs with credits, price, bonus and status', async () => {
    renderPacks();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Credit packs' }),
    ).toBeInTheDocument();
    await screen.findByRole('table', { name: 'Credit packs' });
    const starter = within(rowOf('Starter'));
    expect(starter.getByText('2,500')).toBeInTheDocument();
    expect(starter.getByText('$25')).toBeInTheDocument();
    expect(starter.getByText('0%')).toBeInTheDocument();
    expect(starter.getByText('Active')).toBeInTheDocument();
    expect(within(rowOf('Growth')).getByText('10%')).toBeInTheDocument();
    expect(screen.getByText(/1 credit = \$0\.01 at list price/)).toBeInTheDocument();
  });

  test('shows an empty state, and an error with retry', async () => {
    packsState.packs = [];
    renderPacks();
    expect(await screen.findByText('No credit packs yet')).toBeInTheDocument();
  });

  test('shows an error with retry', async () => {
    server.use(
      http.get('*/api/staff/credit-packs', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }),
      ),
    );
    renderPacks();
    expect(await screen.findByText('Credit packs did not load')).toBeInTheDocument();
  });

  test('creates a pack: dollars become cents and the list refreshes', async () => {
    const user = userEvent.setup();
    renderPacks();
    await screen.findByRole('table', { name: 'Credit packs' });
    await user.click(screen.getByRole('button', { name: 'New pack' }));
    const form = within(screen.getByRole('form', { name: 'New pack' }));
    await user.type(form.getByLabelText('Name'), 'Pro');
    await user.type(form.getByLabelText('Credits'), '30000');
    await user.type(form.getByLabelText('Price (USD)'), '250');
    await user.click(form.getByRole('button', { name: 'Save pack' }));

    await waitFor(() => expect(screen.getByRole('row', { name: /Pro/ })).toBeInTheDocument());
    expect(packsState.requests).toEqual([
      { method: 'POST', body: { name: 'Pro', credits: 30000, priceCents: 25000, active: true } },
    ]);
    expect(within(rowOf('Pro')).getByText('20%')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'New pack' })).not.toBeInTheDocument();
  });

  test('edits a pack, and can hide it from customers', async () => {
    const user = userEvent.setup();
    renderPacks();
    await screen.findByRole('table', { name: 'Credit packs' });
    await user.click(screen.getByRole('button', { name: 'Edit Growth' }));
    const form = within(screen.getByRole('form', { name: 'Edit Growth' }));
    expect(form.getByLabelText('Credits')).toHaveValue('11000');
    expect(form.getByLabelText('Price (USD)')).toHaveValue('100');
    await user.clear(form.getByLabelText('Credits'));
    await user.type(form.getByLabelText('Credits'), '12000');
    await user.click(form.getByRole('checkbox', { name: 'Active (shown to customers)' }));
    await user.click(form.getByRole('button', { name: 'Save pack' }));

    await waitFor(() => expect(within(rowOf('Growth')).getByText('Hidden')).toBeInTheDocument());
    expect(packsState.requests[0]).toEqual({
      method: 'PUT',
      body: { name: 'Growth', credits: 12000, priceCents: 10000, active: false },
    });
    expect(within(rowOf('Growth')).getByText('12,000')).toBeInTheDocument();
  });

  test('keeps cents when the price has them', async () => {
    const user = userEvent.setup();
    renderPacks();
    await screen.findByRole('table', { name: 'Credit packs' });
    await user.click(screen.getByRole('button', { name: 'New pack' }));
    const form = within(screen.getByRole('form', { name: 'New pack' }));
    await user.type(form.getByLabelText('Name'), 'Tiny');
    await user.type(form.getByLabelText('Credits'), '500');
    await user.type(form.getByLabelText('Price (USD)'), '4.99');
    await user.click(form.getByRole('button', { name: 'Save pack' }));
    await waitFor(() => expect(packsState.requests[0]?.body).toMatchObject({ priceCents: 499 }));
    expect(await screen.findByText('$4.99')).toBeInTheDocument();
  });

  test('validates before sending: required and ranges', async () => {
    const user = userEvent.setup();
    renderPacks();
    await screen.findByRole('table', { name: 'Credit packs' });
    await user.click(screen.getByRole('button', { name: 'New pack' }));
    const form = within(screen.getByRole('form', { name: 'New pack' }));
    await user.click(form.getByRole('button', { name: 'Save pack' }));
    expect((await form.findAllByText('Required')).length).toBeGreaterThanOrEqual(2);
    expect(packsState.requests).toHaveLength(0);

    await user.type(form.getByLabelText('Name'), 'X');
    await user.type(form.getByLabelText('Credits'), '0');
    await user.type(form.getByLabelText('Price (USD)'), '0.10');
    await user.click(form.getByRole('button', { name: 'Save pack' }));
    await waitFor(() => expect(form.getAllByRole('alert').length).toBeGreaterThanOrEqual(2));
    expect(packsState.requests).toHaveLength(0);
  });

  test('field errors from the API appear on the field', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/api/staff/credit-packs', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid',
              fields: { name: 'Name already used' },
            },
          },
          { status: 400 },
        ),
      ),
    );
    renderPacks();
    await screen.findByRole('table', { name: 'Credit packs' });
    await user.click(screen.getByRole('button', { name: 'New pack' }));
    const form = within(screen.getByRole('form', { name: 'New pack' }));
    await user.type(form.getByLabelText('Name'), 'Starter');
    await user.type(form.getByLabelText('Credits'), '100');
    await user.type(form.getByLabelText('Price (USD)'), '5');
    await user.click(form.getByRole('button', { name: 'Save pack' }));
    expect(await form.findByText('Name already used')).toBeInTheDocument();
  });

  test('editing a pack that was deleted meanwhile says so', async () => {
    const user = userEvent.setup();
    renderPacks();
    await screen.findByRole('table', { name: 'Credit packs' });
    await user.click(screen.getByRole('button', { name: 'Edit Growth' }));
    packsState.packs = packsState.packs.filter((p) => p.name !== 'Growth');
    await user.click(screen.getByRole('button', { name: 'Save pack' }));
    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument();
  });

  test('Cancel closes the form without saving', async () => {
    const user = userEvent.setup();
    renderPacks();
    await screen.findByRole('table', { name: 'Credit packs' });
    await user.click(screen.getByRole('button', { name: 'New pack' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New pack' })).not.toBeInTheDocument();
    expect(packsState.requests).toHaveLength(0);
  });
});
