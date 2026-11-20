import { ids } from '@app/contracts/examples';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeRun, researchState, resetResearchState } from './handlers';
import { renderRun } from './render';

const path = `/runs/${ids.run}`;
const steps = [
  { key: 'search-terms', name: 'Search terms', status: 'done' as const },
  { key: 'maps-places', name: 'Maps & places', status: 'done' as const },
  { key: 'websites', name: 'Websites', status: 'running' as const },
  { key: 'contacts', name: 'Contacts', status: 'pending' as const },
];
const running = (patch = {}) =>
  makeRun({
    status: 'running',
    steps,
    startedAt: new Date(Date.now() - 18 * 60_000).toISOString(),
    finishedAt: null,
    leadsDelivered: 0,
    costPerLead: null,
    creditsSpent: 0,
    ...patch,
  });

beforeEach(resetResearchState);
afterEach(() => vi.useRealTimers());

describe('FR-21: Working screen', () => {
  test('shows the Plan name, a step checklist with the current Step highlighted, elapsed time and the email note', async () => {
    researchState.run = running();
    renderRun(path);
    expect(await screen.findByRole('heading', { name: 'Working on it' })).toBeInTheDocument();
    expect(await screen.findByText(/Bakeries near Austin · 18 min so far/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Research steps' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining('Search terms'),
      expect.stringContaining('Maps & places'),
      expect.stringContaining('Websites'),
      expect.stringContaining('Contacts'),
    ]);
    expect(within(list).getByText('Websites').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(
      screen.getByText("We'll email you when your leads are ready. You can close this page."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/attempt|log|tool/i)).not.toBeInTheDocument();
  });

  test('a queued run says it is waiting to start', async () => {
    researchState.run = running({ status: 'queued', startedAt: null });
    renderRun(path);
    expect(await screen.findByText(/Waiting to start/)).toBeInTheDocument();
  });

  test('polls every 10 s and switches to the result when the run completes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    researchState.run = running();
    renderRun(path);
    await screen.findByRole('heading', { name: 'Working on it' });
    const reads = researchState.reads;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    await waitFor(() => expect(researchState.reads).toBeGreaterThan(reads));

    researchState.run = makeRun();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(
      await screen.findByRole('heading', { name: '25 leads ready · 137 credits · 5.5 per lead' }),
    ).toBeInTheDocument();
    const after = researchState.reads;
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(researchState.reads).toBe(after);
  });

  test('completed: See leads opens the Lead list', async () => {
    renderRun(path);
    await userEvent.click(await screen.findByRole('link', { name: 'See leads' }));
    expect(await screen.findByText(`Leads page ${ids.plan}`)).toBeInTheDocument();
  });

  test('cancel asks first, then cancels', async () => {
    researchState.run = running();
    renderRun(path);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel run' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this run?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep going' }));
    expect(researchState.cancelled).toBe(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Yes, cancel run' }),
    );
    await waitFor(() => expect(researchState.cancelled).toBe(1));
    expect(await screen.findByText(/Cancelling/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
  });

  test('a cancelled run says what was charged', async () => {
    researchState.run = makeRun({ status: 'cancelled', creditsSpent: 12, leadsDelivered: 0 });
    renderRun(path);
    expect(
      await screen.findByRole('heading', { name: 'This run was cancelled' }),
    ).toBeInTheDocument();
    expect(screen.getByText('You were charged 12 credits for the work done.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See leads' })).not.toBeInTheDocument();
  });

  test('an unknown run is not found', async () => {
    researchState.run = null;
    renderRun(path);
    expect(await screen.findByRole('heading', { name: 'Run not found' })).toBeInTheDocument();
  });
});

describe('FR-21: a run that did not finish', () => {
  const failed = (patch = {}) =>
    makeRun({
      status: 'failed',
      steps: [
        { key: 'search-terms', name: 'Search terms', status: 'done' },
        { key: 'maps-places', name: 'Maps & places', status: 'failed' },
      ],
      creditsSpent: 0,
      leadsDelivered: 0,
      costPerLead: null,
      failureReason: 'PROVIDER_ERROR',
      ...patch,
    });

  test('AJ-5: shows the charge and the reason in plain words', async () => {
    researchState.run = failed();
    renderRun(path);
    expect(
      await screen.findByRole('heading', { name: "This run didn't finish" }),
    ).toBeInTheDocument();
    expect(screen.getByText('You were charged 0 credits.')).toBeInTheDocument();
    expect(screen.getByText(/One of our data sources didn't respond/)).toBeInTheDocument();
    expect(screen.queryByText(/PROVIDER_ERROR/)).not.toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  test('Try again resumes the run and goes back to the working view', async () => {
    researchState.run = failed();
    renderRun(path);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Working on it' })).toBeInTheDocument();
    expect(researchState.resumed).toBe(1);
  });

  test('Try again with too few credits offers Buy credits and no lower budget', async () => {
    researchState.run = failed();
    researchState.resume = { status: 402, available: 20, required: 300 };
    renderRun(path);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'You need 300 credits, you have 20',
    });
    expect(
      within(dialog).queryByRole('button', { name: /Lower the budget/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Buy credits' }));
    expect(await screen.findByText('Credits page')).toBeInTheDocument();
  });

  test('another failure to resume shows a message', async () => {
    researchState.run = failed();
    researchState.resume = { status: 409 };
    renderRun(path);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/couldn't restart this run/)).toBeInTheDocument();
  });
});

describe('FR-38: taking a little longer', () => {
  test('shows the message and never an attempt number', async () => {
    researchState.run = running({
      takingLonger: true,
      attempt: { current: 2, max: 3 },
      status: 'retrying',
    });
    renderRun(path);
    expect(
      await screen.findByText(
        "Taking a little longer than usual. We're still on it and you won't be charged twice for work already done.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/attempt|\b2 of 3\b|\b2\/3\b/i)).not.toBeInTheDocument();
  });

  test('is absent for a run on schedule', async () => {
    researchState.run = running();
    renderRun(path);
    await screen.findByRole('heading', { name: 'Working on it' });
    expect(screen.queryByText(/Taking a little longer/)).not.toBeInTheDocument();
  });
});
