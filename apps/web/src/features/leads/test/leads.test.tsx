import { errorResponse } from '@app/contracts/errors';
import { ids, plan as planExample } from '@app/contracts/examples';
import { planSummary } from '@app/contracts/planning';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { server } from '../../../test/setup';
import { leadsState, makeLead, makeLeads, otherRunId, resetLeadsState } from './handlers';
import { renderLeads } from './render';

const listPath = `/plans/${ids.plan}/leads`;

beforeEach(resetLeadsState);
afterEach(() => vi.unstubAllGlobals());

const preview = () => screen.getByRole('complementary', { name: 'Lead preview' });
const previewTitle = async (name: string) =>
  within(await screen.findByRole('complementary', { name: 'Lead preview' })).findByRole('heading', {
    level: 2,
    name,
  });
const rowList = () => screen.getByRole('list', { name: 'Lead list' });
const rows = () => within(rowList()).getAllByRole('listitem');
const findRows = async () =>
  within(await screen.findByRole('list', { name: 'Lead list' })).getAllByRole('listitem');
const lastQuery = () => leadsState.listCalls.at(-1)!.searchParams;

function summary(patch: object) {
  const { segments: _s, warnings: _w, ...rest } = { ...planExample, ...patch };
  return planSummary.parse(rest);
}

function plansAre(items: ReturnType<typeof summary>[]) {
  server.use(
    http.get('*/api/plans', () => HttpResponse.json({ items, nextCursor: null })),
    http.get('*/api/plans/:id', ({ params }) => {
      const found = items.find((p) => p.id === params.id);
      return found
        ? HttpResponse.json({ ...planExample, ...found })
        : HttpResponse.json(
            errorResponse.parse({ error: { code: 'NOT_FOUND', message: 'NOT_FOUND' } }),
            { status: 404 },
          );
    }),
  );
}

describe('FR-26: Lead list and preview', () => {
  test('lists the Leads best fit first with stats, and previews the first one', async () => {
    renderLeads(listPath);
    const rows = await findRows();
    expect(rows).toHaveLength(25);
    expect(rows[0]).toHaveTextContent('Bakery 01');
    expect(rows[0]).toHaveTextContent('Bakery · 1 mi');
    expect(rows[0]).toHaveTextContent('email');
    expect(within(rows[0]!).getByLabelText('Fit score 99')).toBeInTheDocument();
    const stats = screen.getByRole('group', { name: 'Lead list statistics' });
    expect(within(stats).getByText('25')).toBeInTheDocument();
    expect(within(stats).getByText('137')).toBeInTheDocument();
    expect(within(stats).getByText('5.5')).toBeInTheDocument();
    expect(await previewTitle('Bakery 01')).toBeInTheDocument();
  });

  test('clicking a row previews it', async () => {
    renderLeads(listPath);
    await userEvent.click(await screen.findByRole('button', { name: /Bakery 05/ }));
    expect(await previewTitle('Bakery 05')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bakery 05/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('J twice previews the third Lead, K goes back, Esc closes the preview', async () => {
    renderLeads(listPath);
    await previewTitle('Bakery 01');
    await userEvent.keyboard('jj');
    expect(await previewTitle('Bakery 03')).toBeInTheDocument();
    await userEvent.keyboard('k');
    expect(await previewTitle('Bakery 02')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByText('Select a lead to see why it fits.')).toBeInTheDocument();
    expect(within(preview()).queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  test('shortcuts do not fire while typing in a field', async () => {
    renderLeads(listPath);
    await previewTitle('Bakery 01');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search leads' }), 'jjgn');
    expect(await previewTitle('Bakery 01')).toBeInTheDocument();
    expect(leadsState.feedbackPuts).toHaveLength(0);
  });

  test('the preview closes with its button too', async () => {
    renderLeads(listPath);
    await previewTitle('Bakery 01');
    await userEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(await screen.findByText('Select a lead to see why it fits.')).toBeInTheDocument();
  });

  test('every contact shows its Source on focus, and Verified state', async () => {
    renderLeads(listPath);
    await previewTitle('Bakery 01');
    const email = await within(preview()).findByText('hello@sunrise.example');
    expect(within(preview()).getByText(/verified/)).toBeInTheDocument();
    const target = email.closest<HTMLElement>('[tabindex="0"]')!;
    act(() => target.focus());
    expect(target).toHaveFocus();
    expect(target).toHaveAccessibleDescription(/Source: Website · Nov 19/);
  });

  test('shows Evidence with points and a Source link and date, and the Pitch', async () => {
    renderLeads(listPath);
    await previewTitle('Bakery 01');
    const evidence = await within(preview()).findByRole('list', { name: 'Evidence' });
    expect(within(evidence).getByText(/Bakes bread on site daily/)).toBeInTheDocument();
    expect(within(evidence).getByText('+20')).toBeInTheDocument();
    expect(within(evidence).getByRole('link', { name: 'Website' })).toHaveAttribute(
      'href',
      'https://sunrise.example',
    );
    expect(within(evidence).getByText(/Nov 19/)).toBeInTheDocument();
    expect(within(preview()).getByText('Cane sugar, 50 lb')).toBeInTheDocument();
    expect(within(preview()).getByText('They bake daily.')).toBeInTheDocument();
  });

  test('Load more fetches the next cursor of 50', async () => {
    leadsState.leads = makeLeads(60);
    renderLeads(listPath);
    expect(await findRows()).toHaveLength(50);
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(rows()).toHaveLength(60));
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(leadsState.listCalls[0]!.searchParams.get('limit')).toBe('50');
  });
});

describe('FR-26: filters and sorts', () => {
  test('min score, run and sort go to the API and the URL', async () => {
    const { router } = renderLeads(listPath);
    await findRows();
    await userEvent.selectOptions(screen.getByLabelText('Min fit score'), '90');
    await waitFor(() => expect(lastQuery().get('minScore')).toBe('90'));
    await waitFor(() => expect(rows()).toHaveLength(10));

    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Run' }), ids.run);
    await waitFor(() => expect(lastQuery().get('runId')).toBe(ids.run));

    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'distance');
    await waitFor(() => expect(lastQuery().get('sort')).toBe('distance'));
    expect(router.state.location.search).toContain('sort=distance');
    expect(router.state.location.search).toContain('minScore=90');
  });

  test('the run filter lists the Plan runs', async () => {
    renderLeads(listPath);
    const select = await screen.findByRole('combobox', { name: 'Run' });
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(3));
    expect(within(select).getByRole('option', { name: 'Nov 10 · 3 leads' })).toHaveValue(
      otherRunId,
    );
  });

  test('Feedback chips filter the list', async () => {
    leadsState.leads = [
      makeLead(1, { feedback: 'good' }),
      makeLead(2),
      makeLead(3, { feedback: 'not_fit' }),
    ];
    renderLeads(listPath);
    await findRows();
    await userEvent.click(screen.getByRole('button', { name: 'Good lead' }));
    await waitFor(() => expect(lastQuery().get('feedback')).toBe('good'));
    await waitFor(() => expect(rows()).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'No feedback yet' }));
    await waitFor(() => expect(lastQuery().get('feedback')).toBe('none'));
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(lastQuery().has('feedback')).toBe(false));
  });

  test('search by name', async () => {
    renderLeads(listPath);
    await findRows();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search leads' }), 'bakery 07');
    await waitFor(() => expect(lastQuery().get('q')).toBe('bakery 07'));
    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  test('no match: "No leads match these filters" and Clear', async () => {
    renderLeads(`${listPath}?q=zzz&minScore=60`);
    expect(
      await screen.findByRole('heading', { name: 'No leads match these filters' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(await findRows()).toHaveLength(25);
    expect(screen.getByRole('searchbox', { name: 'Search leads' })).toHaveValue('');
  });
});

describe('FR-28: Export CSV', () => {
  test('is a plain download link that carries the current filters', async () => {
    renderLeads(`${listPath}?minScore=70&feedback=good&sort=newest&q=bakery`);
    const link = await screen.findByRole('link', { name: 'Export CSV' });
    expect(link).toHaveAttribute('download');
    const url = new URL(link.getAttribute('href')!, 'http://app.test');
    expect(url.pathname).toBe(`/api/plans/${ids.plan}/leads.csv`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      minScore: '70',
      feedback: 'good',
      sort: 'newest',
      q: 'bakery',
    });
  });

  test('follows a filter change', async () => {
    renderLeads(listPath);
    await findRows();
    await userEvent.selectOptions(screen.getByLabelText('Min fit score'), '80');
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Export CSV' }).getAttribute('href')).toContain(
        'minScore=80',
      ),
    );
  });
});

describe('FR-27: Feedback', () => {
  test('G marks a good lead, the row follows, pressing G again clears it', async () => {
    renderLeads(listPath);
    await previewTitle('Bakery 01');
    await userEvent.keyboard('g');
    await waitFor(() =>
      expect(leadsState.feedbackPuts.at(-1)).toEqual({
        id: makeLead(1).id,
        body: { value: 'good' },
      }),
    );
    const good = within(preview()).getByRole('button', { name: /Good lead/ });
    await waitFor(() => expect(good).toHaveAttribute('aria-pressed', 'true'));
    expect(within(rows()[0]!).getByText('Good lead')).toBeInTheDocument();

    await userEvent.keyboard('g');
    await waitFor(() => expect(leadsState.feedbackPuts.at(-1)!.body).toEqual({ value: null }));
    await waitFor(() => expect(good).toHaveAttribute('aria-pressed', 'false'));
    expect(within(rows()[0]!).queryByText('Good lead')).not.toBeInTheDocument();
  });

  test('N marks not a fit and offers reasons; a chip saves the reason', async () => {
    renderLeads(listPath);
    await previewTitle('Bakery 01');
    await userEvent.keyboard('n');
    await userEvent.click(await within(preview()).findByRole('button', { name: 'Closed' }));
    await waitFor(() =>
      expect(leadsState.feedbackPuts.at(-1)!.body).toEqual({ value: 'not_fit', reason: 'Closed' }),
    );
    expect(await within(preview()).findByRole('button', { name: 'Closed' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('other text up to 200 characters', async () => {
    renderLeads(listPath);
    await previewTitle('Bakery 01');
    await userEvent.click(within(preview()).getByRole('button', { name: /Not a fit/ }));
    const input = await within(preview()).findByRole('textbox', { name: 'Other reason' });
    expect(input).toHaveAttribute('maxlength', '200');
    await userEvent.type(input, 'Sells only wholesale');
    await userEvent.click(within(preview()).getByRole('button', { name: 'Save reason' }));
    await waitFor(() =>
      expect(leadsState.feedbackPuts.at(-1)!.body).toEqual({
        value: 'not_fit',
        reason: 'Sells only wholesale',
      }),
    );
  });

  test('a saved reason is kept after reloading, and can be changed or cleared', async () => {
    leadsState.leads = [makeLead(1, { feedback: 'not_fit', feedbackReason: 'Closed' })];
    renderLeads(listPath);
    await previewTitle('Bakery 01');
    expect(await within(preview()).findByRole('button', { name: 'Closed' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(preview()).getByRole('button', { name: /Not a fit/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await userEvent.click(within(preview()).getByRole('button', { name: 'Too far' }));
    await waitFor(() =>
      expect(leadsState.feedbackPuts.at(-1)!.body).toEqual({ value: 'not_fit', reason: 'Too far' }),
    );

    await userEvent.click(within(preview()).getByRole('button', { name: /Good lead/ }));
    await waitFor(() => expect(leadsState.feedbackPuts.at(-1)!.body).toEqual({ value: 'good' }));
    expect(within(preview()).queryByRole('button', { name: 'Too far' })).not.toBeInTheDocument();

    await userEvent.click(within(preview()).getByRole('button', { name: 'Clear feedback' }));
    await waitFor(() => expect(leadsState.feedbackPuts.at(-1)!.body).toEqual({ value: null }));
    expect(
      within(preview()).queryByRole('button', { name: 'Clear feedback' }),
    ).not.toBeInTheDocument();
  });

  test('a failed save says so', async () => {
    leadsState.failFeedback = true;
    renderLeads(listPath);
    await previewTitle('Bakery 01');
    await userEvent.keyboard('g');
    expect(await screen.findByText(/couldn't save your feedback/)).toBeInTheDocument();
  });
});

describe('FR-26: empty states and switching Plans', () => {
  test('no Leads yet: start research from the plan', async () => {
    leadsState.leads = [];
    renderLeads(listPath);
    expect(await screen.findByRole('heading', { name: 'No leads yet' })).toBeInTheDocument();
    expect(screen.getByText('Start research from your plan.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Go to plan' }));
    expect(await screen.findByText(`Plan page ${ids.plan}`)).toBeInTheDocument();
  });

  test('a run in progress links to the working screen', async () => {
    leadsState.leads = [];
    plansAre([summary({ lastRun: { ...planExample.lastRun!, status: 'running', id: ids.run } })]);
    renderLeads(listPath);
    await userEvent.click(await screen.findByRole('link', { name: 'View progress' }));
    expect(await screen.findByText(`Run page ${ids.run}`)).toBeInTheDocument();
  });

  test('the plan switcher opens another Plan', async () => {
    const other = '0193a1b2-0000-7000-8000-0000000000a4';
    plansAre([summary({}), summary({ id: other, name: 'Coffee shops near Austin' })]);
    const { router } = renderLeads(listPath);
    const select = await screen.findByRole('combobox', { name: 'Plan' });
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2));
    await userEvent.selectOptions(select, other);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/plans/${other}/leads`));
  });

  test('an unknown Plan is not found', async () => {
    plansAre([]);
    renderLeads(`/plans/${'0193a1b2-0000-7000-8000-0000000000ff'}/leads`);
    expect(await screen.findByRole('heading', { name: 'Plan not found' })).toBeInTheDocument();
  });

  test('a failed list can be retried', async () => {
    server.use(
      http.get('*/api/plans/:id/leads', () => new HttpResponse(null, { status: 500 }), {
        once: true,
      }),
    );
    renderLeads(listPath);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await findRows()).toHaveLength(25);
  });
});

describe('The Leads rail item (/leads)', () => {
  test('opens the most recent Plan', async () => {
    const newer = '0193a1b2-0000-7000-8000-0000000000a5';
    plansAre([
      summary({ id: ids.plan, createdAt: '2026-11-01T10:00:00.000Z' }),
      summary({ id: newer, name: 'Newer plan', createdAt: '2026-11-18T10:00:00.000Z' }),
    ]);
    const { router } = renderLeads('/leads');
    await waitFor(() => expect(router.state.location.pathname).toBe(`/plans/${newer}/leads`));
  });

  test('with no Plans shows the Plans empty state', async () => {
    plansAre([]);
    renderLeads('/leads');
    expect(
      await screen.findByRole('heading', { name: 'Tell us who you want to find' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'New plan' }));
    expect(await screen.findByText('New plan page')).toBeInTheDocument();
  });
});

describe('FR-26: Lead detail (/leads/:id)', () => {
  const detail = `/leads/${makeLead(1).id}`;

  test('shows contacts with Verified state and Source, Evidence, Pitch and the Plan', async () => {
    renderLeads(detail);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bakery 01' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Contacts' });
    const row = within(table).getByRole('row', { name: /Email/ });
    expect(within(row).getByText(/verified/)).toBeInTheDocument();
    expect(within(row).getByText('Website · Nov 19')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Evidence' })).toHaveTextContent('+20');
    expect(screen.getByText('They bake daily.')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '← Bakeries near Austin' })).toHaveAttribute(
      'href',
      `/plans/${ids.plan}/leads`,
    );
    expect(
      screen.getByText(/Found in the run on Nov 1 · Plan Bakeries near Austin/),
    ).toBeInTheDocument();
  });

  test('G and N work on the detail page', async () => {
    renderLeads(detail);
    await screen.findByRole('heading', { level: 1, name: 'Bakery 01' });
    await userEvent.keyboard('g');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Good lead/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    await userEvent.keyboard('n');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Not a fit/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
  });

  test('an unknown Lead is not found', async () => {
    renderLeads(`/leads/${'0193a1b2-0000-7000-8000-0000000fffff'}`);
    expect(await screen.findByRole('heading', { name: 'Lead not found' })).toBeInTheDocument();
  });
});

describe('Phone layout', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 767px'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });

  test('the list is full width and the preview opens as its own view', async () => {
    renderLeads(listPath);
    expect(await findRows()).toHaveLength(25);
    expect(screen.queryByRole('complementary', { name: 'Lead preview' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Bakery 02/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Bakery 02' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Lead list' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Back to leads/ }));
    expect(await findRows()).toHaveLength(25);
  });
});
