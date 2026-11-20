import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, test } from 'vitest';
import { server } from '../../../../test/setup';
import { handlers, resetToolsState, toolsState } from './handlers';
import { renderTools } from './render';

beforeEach(() => {
  resetToolsState();
  server.use(...handlers);
});

const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(name) });

describe('FR-23: tools and rate card', () => {
  test('lists tools with unit, cost, credits, margin, configured and health', async () => {
    renderTools();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tools & Rate card' }),
    ).toBeInTheDocument();
    await screen.findByRole('table', { name: 'Tools and rate card' });
    const places = within(rowOf('Google Places Text Search'));
    expect(places.getByText('$0.0320')).toBeInTheDocument();
    expect(places.getByLabelText('Credits per unit, Google Places Text Search')).toHaveValue('8');
    expect(places.getByText('60%')).toBeInTheDocument();
    expect(places.queryByText(/LOW MARGIN/)).not.toBeInTheDocument();
    expect(places.getByText('✓ Key set')).toBeInTheDocument();
    expect(places.getByText('10 · 0%')).toBeInTheDocument();
    const hunter = within(rowOf('Hunter domain search'));
    expect(hunter.getByText('Not configured')).toBeInTheDocument();
    expect(hunter.getByText('0 · —')).toBeInTheDocument();
    expect(hunter.getByRole('switch', { name: /Enabled, Hunter/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  test('flags a margin under 60% and updates it live as credits change', async () => {
    const user = userEvent.setup();
    renderTools();
    await screen.findByRole('table', { name: 'Tools and rate card' });
    const insta = within(rowOf('Apify Instagram profile'));
    expect(insta.getByText('48%')).toBeInTheDocument();
    expect(insta.getByText(/LOW MARGIN/)).toBeInTheDocument();
    const input = insta.getByLabelText('Credits per unit, Apify Instagram profile');
    await user.clear(input);
    await user.type(input, '1');
    expect(insta.getByText('74%')).toBeInTheDocument();
    expect(insta.queryByText(/LOW MARGIN/)).not.toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '0.4');
    expect(insta.getByText(/LOW MARGIN/)).toBeInTheDocument();
  });

  test('saves only the changed tools, then confirms', async () => {
    const user = userEvent.setup();
    renderTools();
    await screen.findByRole('table', { name: 'Tools and rate card' });
    const insta = within(rowOf('Apify Instagram profile'));
    const input = insta.getByLabelText('Credits per unit, Apify Instagram profile');
    await user.clear(input);
    await user.type(input, '1');
    await user.click(within(rowOf('Hunter domain search')).getByRole('switch'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes saved')).toBeInTheDocument();
    expect(toolsState.patches).toHaveLength(2);
    expect(toolsState.patches).toEqual(
      expect.arrayContaining([
        { key: 'apify.instagram', body: { creditsPerUnit: 1 } },
        { key: 'hunter.domain-search', body: { enabled: true } },
      ]),
    );
    await waitFor(() =>
      expect(
        within(rowOf('Apify Instagram profile')).queryByText(/LOW MARGIN/),
      ).not.toBeInTheDocument(),
    );
  });

  test('says there is nothing to save when nothing changed', async () => {
    const user = userEvent.setup();
    renderTools();
    await screen.findByRole('table', { name: 'Tools and rate card' });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('No changes to save')).toBeInTheDocument();
    expect(toolsState.patches).toEqual([]);
  });

  test('rejects a credits value outside 0.001 to 10,000 without calling the API', async () => {
    const user = userEvent.setup();
    renderTools();
    await screen.findByRole('table', { name: 'Tools and rate card' });
    const input = within(rowOf('Apify Instagram profile')).getByLabelText(
      'Credits per unit, Apify Instagram profile',
    );
    await user.clear(input);
    await user.type(input, '0');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter 0.001 to 10,000')).toBeInTheDocument();
    expect(toolsState.patches).toEqual([]);
  });

  test('shows a 400 from the server on the row', async () => {
    const user = userEvent.setup();
    toolsState.failKey = 'apify.instagram';
    renderTools();
    await screen.findByRole('table', { name: 'Tools and rate card' });
    const input = within(rowOf('Apify Instagram profile')).getByLabelText(
      'Credits per unit, Apify Instagram profile',
    );
    await user.clear(input);
    await user.type(input, '2');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Must be at least 0.001')).toBeInTheDocument();
    expect(screen.getByText(/Some changes were not saved/)).toBeInTheDocument();
  });

  test('shows an error with retry', async () => {
    server.use(
      http.get('*/api/staff/tools', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }),
      ),
    );
    renderTools();
    expect(await screen.findByText('Tools did not load')).toBeInTheDocument();
  });
});
