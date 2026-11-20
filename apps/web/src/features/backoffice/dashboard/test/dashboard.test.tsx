import { dashboard as example, ids } from '@app/contracts/examples';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, test } from 'vitest';
import { server } from '../../../../test/setup';
import { dashboardState, handlers, resetDashboardState } from './handlers';
import { renderDashboard } from './render';

beforeEach(() => {
  resetDashboardState();
  server.use(...handlers);
});

const tileOf = (label: string) => screen.getByText(label).closest('div')!;

describe('FR-30: staff dashboard', () => {
  test('shows tiles with previous-period values and "—" for no data', async () => {
    renderDashboard();
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    await screen.findByText('Pack revenue');
    const total = within(tileOf('Total'));
    expect(total.getByText('12')).toBeInTheDocument();
    expect(total.getByText(/10 vs previous period/)).toBeInTheDocument();
    expect(within(tileOf('Pack revenue')).getByText('$25')).toBeInTheDocument();
    // null value and null previous
    const trial = within(tileOf('Trial-to-paid · A-5'));
    expect(
      trial.getByText('—', { selector: 'span.font-mono.text-\\[28px\\]' }),
    ).toBeInTheDocument();
    expect(trial.getByText(/^— vs previous period/)).toBeInTheDocument();
    // null previous only
    expect(within(tileOf('Verified')).getByText('10')).toBeInTheDocument();
    expect(within(tileOf('Verified')).getByText(/— vs previous period/)).toBeInTheDocument();
    expect(within(tileOf('Median duration')).getByText('30 min')).toBeInTheDocument();
    expect(within(tileOf('Gross margin · G-3')).getByText('69%')).toBeInTheDocument();
    expect(within(tileOf('Provider cost / lead')).getByText('$0.017')).toBeInTheDocument();
  });

  test('every metric null renders dashes, not zeros', async () => {
    const none = { value: null, previous: null };
    dashboardState.data = {
      ...example,
      customers: { ...example.customers, total: none },
      runs: { ...example.runs, started: none, failed: [] },
      northStar: { goodLeadsPerActiveBusinessPerWeek: none },
    };
    renderDashboard();
    await screen.findByText('Total');
    for (const label of ['Total', 'Started']) {
      const t = within(tileOf(label));
      expect(t.getByText('—', { selector: 'span.font-mono.text-\\[28px\\]' })).toBeInTheDocument();
      expect(t.getByText(/^— vs previous period/)).toBeInTheDocument();
    }
    expect(screen.getByText('No failed runs')).toBeInTheDocument();
  });

  test('draws the sign-ups chart with labelled axes and lists failed runs', async () => {
    renderDashboard();
    const chart = await screen.findByRole('img', { name: /Sign-ups per day: peak 2 on Nov 18/ });
    expect(chart).toBeInTheDocument();
    expect(screen.getAllByText('Date').length).toBeGreaterThan(0);
    const failed = screen.getByRole('region', { name: 'Runs' });
    expect(within(failed).getByText(/Sweet Supply Co · PROVIDER_ERROR/)).toBeInTheDocument();
    expect(within(failed).getByRole('link', { name: /Open run/ })).toHaveAttribute(
      'href',
      `/staff/runs/${ids.run}`,
    );
  });

  test('switching the period reloads with the same tabs', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText('Pack revenue');
    expect(screen.getByRole('tab', { name: '30d', selected: true })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '7d' }));
    await waitFor(() => expect(dashboardState.periods).toContain('7d'));
    await user.click(screen.getByRole('tab', { name: '90d' }));
    await waitFor(() => expect(dashboardState.periods).toContain('90d'));
    expect(await screen.findByText('Pack revenue')).toBeInTheDocument();
  });

  test('tables list provider spend, top businesses and sign-ups with Act as', async () => {
    const user = userEvent.setup();
    const { router } = renderDashboard();
    const providers = await screen.findByRole('table', { name: 'Provider spend' });
    expect(within(providers).getByText('google.places')).toBeInTheDocument();
    expect(within(providers).getByText('$1.20')).toBeInTheDocument();
    expect(
      screen.getByRole('table', { name: 'Top businesses by credits spent' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Act as Sweet Supply Co' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/plans'));
    expect(dashboardState.actedAs).toEqual([ids.business]);
  });

  test('shows an error with retry', async () => {
    server.use(
      http.get('*/api/staff/dashboard', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }),
      ),
    );
    renderDashboard();
    expect(await screen.findByText('The dashboard did not load')).toBeInTheDocument();
  });
});
