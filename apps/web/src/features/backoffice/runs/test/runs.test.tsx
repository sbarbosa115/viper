import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, test } from 'vitest';
import { server } from '../../../../test/setup';
import {
  failedDetail,
  failedRun,
  handlers,
  resetRunsState,
  retryingRun,
  runsState,
} from './handlers';
import { renderRuns } from './render';

beforeEach(() => {
  resetRunsState();
  server.use(...handlers);
});

const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(name) });

describe('FR-32: runs list', () => {
  test('lists runs with flow version, attempts and status words with symbols', async () => {
    renderRuns();
    expect(await screen.findByRole('heading', { level: 1, name: 'Runs' })).toBeInTheDocument();
    await screen.findByRole('table', { name: 'Runs' });
    const retrying = within(rowOf('Hill Country Linens'));
    expect(retrying.getByText('Retrying')).toBeInTheDocument();
    expect(retrying.getByText(/attempt 2 of 3 · from step 3/)).toBeInTheDocument();
    expect(retrying.getByText('2/3')).toBeInTheDocument();
    expect(retrying.getByText('Local buyers v3')).toBeInTheDocument();
    const running = within(rowOf('Austin Party Rentals'));
    expect(running.getByText(/step 2 of 3|step 3 of 3/)).toBeInTheDocument();
    expect(running.getByText('Staff')).toBeInTheDocument();
    const failed = within(rowOf('Corner Coffee Roasters'));
    expect(failed.getByText('Failed')).toBeInTheDocument();
    expect(failed.getByText(/PROVIDER_ERROR · after 3 attempts/)).toBeInTheDocument();
    const completed = within(rowOf('Sweet Supply Co'));
    expect(completed.getByText('Completed')).toBeInTheDocument();
    expect(completed.getByText(/budget reached/)).toBeInTheDocument();
    expect(completed.getByText('25')).toBeInTheDocument();
    expect(completed.getByText('$0.42')).toBeInTheDocument();
    expect(completed.getByText('30 min')).toBeInTheDocument();
  });

  test('opens a run from its row', async () => {
    const user = userEvent.setup();
    const { router } = renderRuns();
    await screen.findByRole('table', { name: 'Runs' });
    await user.click(screen.getByRole('link', { name: 'Open run for Hill Country Linens' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/staff/runs/${retryingRun.id}`),
    );
  });

  test('filters by status, including Retrying, and by business', async () => {
    const user = userEvent.setup();
    renderRuns();
    await screen.findByRole('table', { name: 'Runs' });
    await user.selectOptions(screen.getByLabelText('Status'), 'retrying');
    await waitFor(() => expect(runsState.queries.at(-1)).toMatchObject({ status: 'retrying' }));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(screen.getByText('Hill Country Linens', { selector: 'span' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), '');
    await user.selectOptions(screen.getByLabelText('Business'), failedRun.business.id);
    await waitFor(() =>
      expect(runsState.queries.at(-1)).toMatchObject({ businessId: failedRun.business.id }),
    );
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(screen.getByText('Offices in East Austin')).toBeInTheDocument();
  });

  test('shows an empty state for a filter with no runs', async () => {
    const user = userEvent.setup();
    renderRuns();
    await screen.findByRole('table', { name: 'Runs' });
    await user.selectOptions(screen.getByLabelText('Status'), 'cancelled');
    expect(await screen.findByText('No runs match these filters.')).toBeInTheDocument();
  });

  test('shows the queue health strip with retrying, stalled and worker heartbeat', async () => {
    runsState.queue = { ...runsState.queue, stalledFound: 2 };
    renderRuns();
    const strip = await screen.findByRole('region', { name: 'Queue' });
    await within(strip).findByText(/sweeper ran 40 s ago/);
    const counts = (label: string) => within(strip).getByText(label).nextElementSibling;
    expect(counts('Active')).toHaveTextContent('2');
    expect(counts('Retrying')).toHaveTextContent('1');
    expect(counts('Failed')).toHaveTextContent('1');
    expect(counts('Stalled')).toHaveTextContent('2');
    expect(within(strip).getByText(/Worker last seen 12 s ago/)).toBeInTheDocument();
    expect(within(strip).getByText('● OK')).toBeInTheDocument();
  });

  test('flags a worker that has not been seen recently', async () => {
    runsState.queue = {
      ...runsState.queue,
      workerLastSeenAt: new Date(Date.now() - 600_000).toISOString(),
    };
    renderRuns();
    expect(await screen.findByText('✕ Not responding')).toBeInTheDocument();
  });

  test('shows an error with retry, and a queue error without hiding the list', async () => {
    server.use(
      http.get('*/api/staff/queue', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }),
      ),
    );
    renderRuns();
    expect(await screen.findByText('Queue health did not load')).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Runs' })).toBeInTheDocument();
  });

  test('shows an error when the list fails', async () => {
    server.use(
      http.get('*/api/staff/runs', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }),
      ),
    );
    renderRuns();
    expect(await screen.findByText('Runs did not load')).toBeInTheDocument();
  });
});

describe('FR-32 + FR-36: run detail', () => {
  const path = `/staff/runs/${failedDetail.id}`;

  test('shows header facts, flow and the limits line from the same flow version', async () => {
    renderRuns(path);
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Corner Coffee Roasters · Offices in East Austin',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Failed · PROVIDER_ERROR · after 3 attempts/)).toBeInTheDocument();
    expect(screen.getByText(/Flow: Local buyers v1/)).toBeInTheDocument();
    expect(screen.getByText('Attempts 3 of 3', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '‹ Runs' })).toHaveAttribute('href', '/staff/runs');
  });

  test('shows the attempt timeline with waits, outcomes and handoff cards', async () => {
    renderRuns(path);
    const attempts = await screen.findByRole('region', { name: 'Attempts' });
    expect(within(attempts).getByRole('heading', { name: 'Attempt 1' })).toBeInTheDocument();
    expect(within(attempts).getByRole('heading', { name: 'Attempt 3' })).toBeInTheDocument();
    expect(
      within(attempts).getByText('✕ Ended: worker stopped responding (no heartbeat for 2 min)'),
    ).toBeInTheDocument();
    expect(within(attempts).getByText(/Started at step 1 Search terms/)).toBeInTheDocument();
    expect(within(attempts).getByText(/Started at step 2 Websites, item 12/)).toBeInTheDocument();
    expect(within(attempts).getByText('↻ waited 2 min (flow setting)')).toBeInTheDocument();
    expect(within(attempts).getByText('↻ waited 5 min (flow setting)')).toBeInTheDocument();
    expect(
      within(attempts).getByText('✕ Ended: failed for good (Provider returned 500)'),
    ).toBeInTheDocument();
    // Handoff cards: attempt 2 starts from attempt 1's handoff, attempt 3 from attempt 2's.
    const h2 = within(attempts).getByRole('heading', {
      name: 'What attempt 2 started from',
    }).parentElement!;
    expect(within(h2).getByText('Websites · 12 done · 18 left')).toBeInTheDocument();
    expect(within(h2).getByText(/74 hotels after merging/)).toBeInTheDocument();
    expect(within(h2).getByText('lease expired at 10:21:40')).toBeInTheDocument();
    expect(within(h2).getByText('288')).toBeInTheDocument();
    expect(within(h2).getByText('41 min')).toBeInTheDocument();
    const h3 = within(attempts).getByRole('heading', {
      name: 'What attempt 3 started from',
    }).parentElement!;
    expect(within(h3).getByText('Provider flaky')).toBeInTheDocument();
    expect(
      within(attempts).queryByRole('heading', { name: 'What attempt 1 started from' }),
    ).not.toBeInTheDocument();
  });

  test('lists steps with the attempt column and expands tool calls with reused calls not charged', async () => {
    const user = userEvent.setup();
    renderRuns(path);
    const table = await screen.findByRole('table', { name: 'Steps' });
    expect(within(table).getByRole('columnheader', { name: 'Attempt' })).toBeInTheDocument();
    const websites = within(within(table).getByRole('row', { name: /Websites/ }));
    expect(websites.getByText('1 → 2')).toBeInTheDocument();
    expect(websites.getByText('66 KB')).toBeInTheDocument();
    expect(websites.getByText(/✕ failed · Provider returned 500/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show tool calls (4) for Websites' }));
    const calls = await screen.findByRole('table', { name: 'Tool calls for Websites' });
    expect(screen.getByText(/2 calls reused from earlier attempts/)).toBeInTheDocument();
    expect(within(calls).getAllByText('Reused · not charged')).toHaveLength(2);
    expect(within(calls).getByText('✕ error · 429 rate limited')).toBeInTheDocument();
    expect(within(calls).getAllByRole('columnheader', { name: 'Attempt' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Hide tool calls for Websites' }));
    expect(
      screen.queryByRole('table', { name: 'Tool calls for Websites' }),
    ).not.toBeInTheDocument();
  });

  test('Resume is enabled only for a failed run and starts a new attempt', async () => {
    const user = userEvent.setup();
    renderRuns(path);
    const resume = await screen.findByRole('button', { name: 'Resume' });
    expect(resume).toBeEnabled();
    expect(screen.getByText(/Only failed runs/)).toBeInTheDocument();
    await user.click(resume);
    expect(await screen.findByText(/Resume started/)).toBeInTheDocument();
    expect(runsState.resumes).toEqual([failedDetail.id]);
  });

  test.each(['running', 'retrying', 'completed', 'cancelled', 'queued'] as const)(
    'Resume is disabled while the run is %s',
    async (status) => {
      runsState.detail = { ...failedDetail, status, failureReason: null };
      renderRuns(path);
      expect(await screen.findByRole('button', { name: 'Resume' })).toBeDisabled();
    },
  );

  test('Resume shows the 402 and 409 reasons', async () => {
    const user = userEvent.setup();
    runsState.resumeError = 'credits';
    renderRuns(path);
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    expect(await screen.findByText(/needs 200, has 12/)).toBeInTheDocument();
  });

  test('Resume shows a run-in-progress conflict', async () => {
    const user = userEvent.setup();
    runsState.resumeError = 'busy';
    renderRuns(path);
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    expect(await screen.findByText('This run is already running or retrying.')).toBeInTheDocument();
  });

  test('shows a not-found state for an unknown run', async () => {
    renderRuns('/staff/runs/0193a1b2-0000-7000-8000-00000000ffff');
    expect(await screen.findByRole('heading', { name: 'Run not found' })).toBeInTheDocument();
  });
});
