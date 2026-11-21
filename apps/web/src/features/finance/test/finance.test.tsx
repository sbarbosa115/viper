import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { server } from '../../../test/setup';
import { currentMonth, dollarsToCents, formatMoney, monthRange } from '../lib/format';
import { resolveMonth } from '../lib/params';
import { emptyPnl, novemberPnl, seedInvoiceRows } from './fixtures';
import { financeState, handlers, resetFinanceState } from './handlers';
import { renderFinance } from './render';

const MINUS = '−';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
  resetFinanceState();
  server.use(...handlers);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function stubMobile() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

const serverError = () =>
  HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 });

describe('FR-9: P&L tab', () => {
  test('AC: November shows the seeded statement', async () => {
    renderFinance();
    expect(await screen.findByRole('heading', { level: 1, name: 'Expenses' })).toBeInTheDocument();
    const statement = within(
      await screen.findByRole('table', { name: 'Profit and loss statement' }),
    );
    expect(statement.getByRole('row', { name: /Credit pack sales/ })).toHaveTextContent('$197.00');
    expect(statement.getByRole('row', { name: /Payments fees/ })).toHaveTextContent('$6.61');
    expect(statement.getByRole('row', { name: /^AI/ })).toHaveTextContent('$44.10');
    expect(statement.getByRole('row', { name: /^Data providers/ })).toHaveTextContent('$87.90');
    expect(statement.getByRole('row', { name: /Gross profit/ })).toHaveTextContent('$58.39');
    expect(statement.getByRole('row', { name: /Gross profit/ })).toHaveTextContent('29.6% margin');
    expect(statement.getByRole('row', { name: /Legal & admin/ })).toHaveTextContent('$300.00');
    expect(statement.getByRole('row', { name: /^Net profit/ })).toHaveTextContent(
      `${MINUS}$325.75`,
    );
    expect(screen.getByText('3 pack sales')).toBeInTheDocument();
    expect(screen.getAllByText('$522.75').length).toBeGreaterThan(0);
    expect(screen.getByText('$135.40')).toBeInTheDocument();
    expect(screen.getByText('Burn this month')).toBeInTheDocument();
  });

  test('the current month is labelled "Month to date" and is the default selection', async () => {
    renderFinance();
    expect(await screen.findByText('Month to date')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveValue('2026-11');
    expect(screen.getByRole('option', { name: 'November 2026 (to date)' })).toBeInTheDocument();
  });

  test('tabs have tablist semantics and the P&L tab is the default', async () => {
    const user = userEvent.setup();
    const { router } = renderFinance();
    const list = await screen.findByRole('tablist', { name: 'Expenses sections' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['P&L', 'Expenses', 'Provider invoices']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[0]!.id);
    tabs[0]!.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(router.state.location.search).toBe('?tab=expenses'));
  });

  test('FR-11 AC: over budget shows the banner, a progress bar and the alerts', async () => {
    renderFinance();
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('Over budget: $522.75 of $300.00 (174%)');
    expect(banner).toHaveTextContent('80% and 100% alerts emailed to Staff this month.');
    const bar = screen.getByRole('progressbar', { name: 'Budget used' });
    expect(bar).toHaveAttribute('aria-valuetext', '174%');
    expect(screen.getByText('Over budget', { selector: 'span' })).toBeInTheDocument();
  });

  test('FR-11 AC: raising the Budget to $600 shows 87% near budget', async () => {
    const user = userEvent.setup();
    renderFinance();
    await screen.findByRole('table', { name: 'Profit and loss statement' });
    await user.click(screen.getAllByRole('button', { name: 'Edit budget' })[0]!);
    const dialog = within(screen.getByRole('dialog', { name: 'Monthly budget' }));
    const field = dialog.getByLabelText('Monthly budget (USD)');
    await user.clear(field);
    await user.type(field, '600');
    await user.click(dialog.getByRole('button', { name: 'Save budget' }));
    expect(await screen.findByText('Near budget: $522.75 of $600.00 (87%)')).toBeInTheDocument();
    expect(financeState.requests).toEqual([
      { method: 'PUT', path: '/budget', body: { monthlyBudgetCents: 60000 } },
    ]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('the budget dialog rejects text that is not an amount', async () => {
    const user = userEvent.setup();
    renderFinance();
    await screen.findByRole('table', { name: 'Profit and loss statement' });
    await user.click(screen.getAllByRole('button', { name: 'Edit budget' })[0]!);
    const dialog = within(screen.getByRole('dialog'));
    await user.clear(dialog.getByLabelText('Monthly budget (USD)'));
    await user.type(dialog.getByLabelText('Monthly budget (USD)'), 'lots');
    await user.click(dialog.getByRole('button', { name: 'Save budget' }));
    expect(await dialog.findByText('Enter an amount like 49.00')).toBeInTheDocument();
    expect(financeState.requests).toEqual([]);
  });

  test('the 12-month chart has a text alternative with "No data" for early months', async () => {
    renderFinance();
    expect(
      await screen.findByRole('img', { name: /Revenue and expenses by month/ }),
    ).toBeInTheDocument();
    const table = within(screen.getByRole('table', { name: 'Last 12 months, as a table' }));
    expect(table.getAllByText('No data')).toHaveLength(33);
    expect(table.getByRole('row', { name: /November 2026/ })).toHaveTextContent(
      `$197.00$522.75${MINUS}$325.75`,
    );
    expect(screen.getByText('No data before Nov 2026 (launch).')).toBeInTheDocument();
  });

  test('lists category shares, yearly bills with the monthly equivalent, and the gap link', async () => {
    renderFinance();
    const categories = within(await screen.findByRole('table', { name: 'Expenses by category' }));
    expect(categories.getByRole('row', { name: /Legal & admin/ })).toHaveTextContent('$300.00');
    expect(categories.getByRole('row', { name: /Legal & admin/ })).toHaveTextContent('57%');
    expect(screen.getByText('Yearly bills this month')).toBeInTheDocument();
    expect(screen.getByText('$1.25/mo equivalent')).toBeInTheDocument();
    expect(screen.getByText(/1 provider gap over 15% this month/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Provider invoices' })).toHaveAttribute(
      'href',
      '/staff/expenses?tab=invoices&month=2026-11',
    );
  });

  test('FR-10: Export CSV links to the selected month', async () => {
    renderFinance();
    const link = await screen.findByRole('link', { name: 'Export CSV' });
    expect(link).toHaveAttribute('href', '/api/staff/finance/pnl.csv?from=2026-11&to=2026-11');
  });

  test('AC: a month with nothing shows the empty state', async () => {
    server.use(http.get('*/api/staff/finance/pnl', () => HttpResponse.json(emptyPnl('2026-11'))));
    renderFinance();
    expect(await screen.findByText('Nothing recorded for November 2026 yet.')).toBeInTheDocument();
  });

  test('shows a loading skeleton, then an error with Retry that recovers', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.get('*/api/staff/finance/pnl', () => {
        calls += 1;
        return calls === 1 ? serverError() : HttpResponse.json(novemberPnl());
      }),
    );
    renderFinance();
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(await screen.findByText('This did not load')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByRole('table', { name: 'Profit and loss statement' }),
    ).toBeInTheDocument();
  });
});

describe('FR-1: Expenses list', () => {
  test('AC: lists the bills and the one-off with amounts, cadence, next charge and cover', async () => {
    renderFinance('?tab=expenses');
    const table = within(await screen.findByRole('table', { name: 'Expenses' }));
    expect(table.getAllByRole('row')).toHaveLength(8);
    const resend = table.getByRole('row', { name: /Resend/ });
    expect(resend).toHaveTextContent('Email');
    expect(resend).toHaveTextContent('$20.00');
    expect(resend).toHaveTextContent('Monthly');
    expect(resend).toHaveTextContent('Dec 18, 2026');
    expect(table.getByRole('row', { name: /llyner.com/ })).toHaveTextContent('Yearly');
    expect(table.getByRole('row', { name: /Apify Starter/ })).toHaveTextContent(
      'covers Apify usage',
    );
    expect(table.getByRole('row', { name: /Terms and privacy/ })).toHaveTextContent('One-off');
    expect(table.getByRole('row', { name: /Terms and privacy/ })).toHaveTextContent(
      'Paid Nov 12, 2026',
    );
    expect(screen.getByText(/Fixed run-rate \$135\.40\/mo/)).toBeInTheDocument();
    expect(screen.getByText(/don't appear here/)).toBeInTheDocument();
  });

  test('kind chips count and filter; the category filter and ended toggle reach the API', async () => {
    const user = userEvent.setup();
    renderFinance('?tab=expenses');
    await screen.findByRole('table', { name: 'Expenses' });
    expect(screen.getByRole('button', { name: 'All · 7' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'One-off · 1' }));
    const table = within(screen.getByRole('table', { name: 'Expenses' }));
    expect(table.getAllByRole('row')).toHaveLength(2);

    const seen: string[] = [];
    server.use(
      http.get('*/api/staff/finance/expenses', ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({
          month: '2026-11',
          items: [],
          totals: {
            fixedRunRate: { cents: 0, currency: 'usd' },
            chargesInMonth: { cents: 0, currency: 'usd' },
          },
        });
      }),
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'email');
    await user.click(screen.getByRole('checkbox', { name: 'Show ended bills' }));
    expect(await screen.findByText('No expenses match these filters')).toBeInTheDocument();
    expect(seen.at(-1)).toBe('?month=2026-11&category=email&includeEnded=true');
  });

  test('empty state offers Add expense', async () => {
    server.use(
      http.get('*/api/staff/finance/expenses', () =>
        HttpResponse.json({
          month: '2026-11',
          items: [],
          totals: {
            fixedRunRate: { cents: 0, currency: 'usd' },
            chargesInMonth: { cents: 0, currency: 'usd' },
          },
        }),
      ),
    );
    const user = userEvent.setup();
    renderFinance('?tab=expenses');
    expect(await screen.findByText('No expenses yet')).toBeInTheDocument();
    expect(screen.getByText('Add your hosting, email and domain bills first.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add expense' }));
    expect(screen.getByRole('form', { name: 'Add expense' })).toBeInTheDocument();
  });

  test('shows a loading state and an error with Retry', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.get('*/api/staff/finance/expenses', ({ request }) => {
        calls += 1;
        if (calls === 1) return serverError();
        return HttpResponse.json({
          month: new URL(request.url).searchParams.get('month'),
          items: financeState.expenses,
          totals: {
            fixedRunRate: { cents: 13540, currency: 'usd' },
            chargesInMonth: { cents: 0, currency: 'usd' },
          },
        });
      }),
    );
    renderFinance('?tab=expenses');
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(await screen.findByText('This did not load')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'Expenses' })).toBeInTheDocument();
  });

  test('mobile: bills are tappable cards', async () => {
    stubMobile();
    renderFinance('?tab=expenses');
    const list = within(await screen.findByRole('list', { name: 'Expenses list' }));
    expect(list.getAllByRole('listitem')).toHaveLength(7);
    const card = list.getByRole('button', { name: 'Open Resend' });
    expect(card).toHaveTextContent('Email · next Dec 18, 2026');
    expect(card).toHaveTextContent('$20.00');
    expect(card).toHaveTextContent('monthly');
    expect(screen.queryByRole('table', { name: 'Expenses' })).not.toBeInTheDocument();
  });
});

describe('FR-2 / FR-4: add an expense', () => {
  async function openAdd() {
    const user = userEvent.setup();
    renderFinance('?tab=expenses');
    await screen.findByRole('table', { name: 'Expenses' });
    await user.click(screen.getByRole('button', { name: 'Add expense' }));
    return { user, form: within(screen.getByRole('form', { name: 'Add expense' })) };
  }

  test('adds a monthly bill that covers a provider (contract body, list refreshes)', async () => {
    const { user, form } = await openAdd();
    await user.type(form.getByLabelText('Name'), 'Figma');
    await user.type(form.getByLabelText('Vendor'), 'Figma');
    await user.selectOptions(form.getByLabelText('Category'), 'data_providers');
    await user.selectOptions(await form.findByLabelText('Covers usage of'), 'google-maps-platform');
    await user.type(form.getByLabelText('Amount (USD)'), '15');
    expect(
      form.getByText('Charged on day 20 of every month.', { exact: false }),
    ).toBeInTheDocument();
    await user.click(form.getByRole('button', { name: 'Save expense' }));

    await waitFor(() => expect(screen.getByRole('row', { name: /Figma/ })).toBeInTheDocument());
    expect(financeState.requests).toEqual([
      {
        method: 'POST',
        path: '/expenses',
        body: {
          kind: 'recurring',
          cadence: 'monthly',
          name: 'Figma',
          vendor: 'Figma',
          category: 'data_providers',
          amountCents: 1500,
          startsOn: '2026-11-20',
          coversProvider: 'google-maps-platform',
        },
      },
    ]);
    expect(screen.queryByRole('form', { name: 'Add expense' })).not.toBeInTheDocument();
  });

  test('the provider picker only appears for AI and Data providers and lists matching providers', async () => {
    const { user, form } = await openAdd();
    expect(form.queryByLabelText('Covers usage of')).not.toBeInTheDocument();
    await user.selectOptions(form.getByLabelText('Category'), 'ai');
    const picker = await form.findByLabelText('Covers usage of');
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['No provider', 'Anthropic']);
  });

  test('yearly bills send cadence yearly', async () => {
    const { user, form } = await openAdd();
    await user.click(form.getByRole('radio', { name: 'Yearly' }));
    await user.type(form.getByLabelText('Name'), 'Domain');
    await user.type(form.getByLabelText('Vendor'), 'Registrar');
    await user.type(form.getByLabelText('Amount (USD)'), '$14.99');
    await user.click(form.getByRole('button', { name: 'Save expense' }));
    await waitFor(() => expect(financeState.requests).toHaveLength(1));
    expect(financeState.requests[0]?.body).toMatchObject({
      kind: 'recurring',
      cadence: 'yearly',
      amountCents: 1499,
    });
  });

  test('validates required fields and the amount before calling the API', async () => {
    const { user, form } = await openAdd();
    await user.type(form.getByLabelText('Amount (USD)'), 'abc');
    await user.click(form.getByRole('button', { name: 'Save expense' }));
    expect(await form.findAllByText('Required')).toHaveLength(2);
    expect(form.getByText('Enter an amount like 49.00')).toBeInTheDocument();
    expect(financeState.requests).toEqual([]);
  });

  test('AJ-6: a one-off dated tomorrow shows "Date can\'t be in the future" and saves nothing', async () => {
    const { user, form } = await openAdd();
    await user.click(form.getByRole('radio', { name: 'One-off' }));
    await user.type(form.getByLabelText('Name'), 'Lunch');
    await user.type(form.getByLabelText('Vendor'), 'Cafe');
    await user.type(form.getByLabelText('Amount (USD)'), '20');
    const date = form.getByLabelText('Paid on');
    await user.clear(date);
    await user.type(date, '2026-11-21');
    await user.click(form.getByRole('button', { name: 'Save expense' }));
    expect(await form.findByText("Date can't be in the future")).toBeInTheDocument();
    expect(financeState.expenses).toHaveLength(7);
  });

  test('FR-4 AC: a one-off in the past is recorded with spentOn', async () => {
    const { user, form } = await openAdd();
    await user.click(form.getByRole('radio', { name: 'One-off' }));
    await user.type(form.getByLabelText('Name'), 'Logo');
    await user.type(form.getByLabelText('Vendor'), 'Designer');
    await user.selectOptions(form.getByLabelText('Category'), 'marketing');
    await user.type(form.getByLabelText('Amount (USD)'), '120');
    const date = form.getByLabelText('Paid on');
    await user.clear(date);
    await user.type(date, '2026-11-14');
    await user.click(form.getByRole('button', { name: 'Save expense' }));
    await waitFor(() => expect(financeState.requests).toHaveLength(1));
    expect(financeState.requests[0]?.body).toEqual({
      kind: 'one_off',
      name: 'Logo',
      vendor: 'Designer',
      category: 'marketing',
      amountCents: 12000,
      spentOn: '2026-11-14',
    });
  });

  test('FR-2 AC: a second bill covering Apify shows PROVIDER_ALREADY_COVERED naming the other bill', async () => {
    const { user, form } = await openAdd();
    await user.type(form.getByLabelText('Name'), 'Apify Pro');
    await user.type(form.getByLabelText('Vendor'), 'Apify');
    await user.selectOptions(form.getByLabelText('Category'), 'data_providers');
    await user.selectOptions(await form.findByLabelText('Covers usage of'), 'apify');
    await user.type(form.getByLabelText('Amount (USD)'), '99');
    await user.click(form.getByRole('button', { name: 'Save expense' }));
    expect(
      await screen.findByText(
        'Apify Starter already covers this provider. Change or end that bill first.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Add expense' })).toBeInTheDocument();
  });

  test('mobile: the form is the same panel with a Back button', async () => {
    stubMobile();
    const user = userEvent.setup();
    renderFinance('?tab=expenses');
    await screen.findByRole('list', { name: 'Expenses list' });
    await user.click(screen.getByRole('button', { name: 'Add expense' }));
    expect(screen.getByRole('form', { name: 'Add expense' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to expenses' }));
    expect(screen.queryByRole('form', { name: 'Add expense' })).not.toBeInTheDocument();
  });
});

describe('FR-3: edit, price changes, end and delete', () => {
  async function openResend() {
    const user = userEvent.setup();
    renderFinance('?tab=expenses');
    await screen.findByRole('table', { name: 'Expenses' });
    await user.click(screen.getByRole('button', { name: 'Open Resend' }));
    return { user, panel: within(screen.getByRole('complementary', { name: 'Edit Resend' })) };
  }

  test('the edit panel lists price versions and shows the bill link safely', async () => {
    const { panel } = await openResend();
    expect(panel.getByText('$20.00 from Nov 18, 2026')).toBeInTheDocument();
    expect(panel.getByLabelText('Name')).toHaveValue('Resend');
    expect(panel.getByText('Monthly')).toBeInTheDocument();
    const link = panel.getByRole('link', { name: /Open link/ });
    expect(link).toHaveAttribute('href', 'https://resend.com/settings/billing');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('AJ-2 / AC: add a price change from a date; the panel lists both versions', async () => {
    const { user, panel } = await openResend();
    await user.type(panel.getByLabelText('New amount (USD)'), '25');
    await user.type(panel.getByLabelText('From'), '2026-12-18');
    await user.click(panel.getByRole('button', { name: 'Add price change' }));
    expect(await screen.findByText('$25.00 from Dec 18, 2026')).toBeInTheDocument();
    expect(screen.getByText('$20.00 from Nov 18, 2026')).toBeInTheDocument();
    expect(financeState.requests).toContainEqual({
      method: 'POST',
      path: `/expenses/${financeState.expenses[1]!.id}/prices`,
      body: { effectiveFrom: '2026-12-18', amountCents: 2500 },
    });
  });

  test('Enter in the price row adds the price without saving the whole bill', async () => {
    const { user, panel } = await openResend();
    await user.type(panel.getByLabelText('New amount (USD)'), '30');
    await user.type(panel.getByLabelText('From'), '2026-12-01');
    await user.keyboard('{Enter}');
    expect(await screen.findByText('$30.00 from Dec 1, 2026')).toBeInTheDocument();
    expect(financeState.requests.map((r) => r.method)).toEqual(['POST']);
  });

  test('a price before the bill starts shows the EFFECTIVE_BEFORE_START message', async () => {
    const { user, panel } = await openResend();
    await user.type(panel.getByLabelText('New amount (USD)'), '25');
    await user.type(panel.getByLabelText('From'), '2026-11-02');
    await user.click(panel.getByRole('button', { name: 'Add price change' }));
    expect(
      await panel.findByText("The price can't start before the bill does."),
    ).toBeInTheDocument();
  });

  test('removes a later price version but not the first', async () => {
    const { user, panel } = await openResend();
    expect(
      panel.queryByRole('button', { name: /Remove price from Nov 18, 2026/ }),
    ).not.toBeInTheDocument();
    await user.type(panel.getByLabelText('New amount (USD)'), '25');
    await user.type(panel.getByLabelText('From'), '2026-12-18');
    await user.click(panel.getByRole('button', { name: 'Add price change' }));
    await screen.findByText('$25.00 from Dec 18, 2026');
    await user.click(screen.getByRole('button', { name: 'Remove price from Dec 18, 2026' }));
    await waitFor(() =>
      expect(screen.queryByText('$25.00 from Dec 18, 2026')).not.toBeInTheDocument(),
    );
  });

  test('saves name, category and notes with the patch contract; clearing the link sends null', async () => {
    const { user, panel } = await openResend();
    const name = panel.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Resend Pro');
    await user.selectOptions(panel.getByLabelText('Category'), 'software_tools');
    await user.clear(panel.getByLabelText('Link (optional)'));
    await user.click(panel.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(financeState.requests).toHaveLength(1));
    expect(financeState.requests[0]?.body).toEqual({
      name: 'Resend Pro',
      vendor: 'Resend',
      category: 'software_tools',
      link: null,
      notes: null,
      coversProvider: null,
    });
    expect(await screen.findByRole('row', { name: /Resend Pro/ })).toHaveTextContent(
      'Software & tools',
    );
  });

  test('End: stopping a bill sets endsOn and shows when it ends; Resume clears it', async () => {
    const { user, panel } = await openResend();
    await user.click(panel.getByRole('button', { name: 'Stop this bill…' }));
    await user.type(panel.getByLabelText('Last charge on or before'), '2026-12-31');
    await user.click(panel.getByRole('button', { name: 'Stop bill' }));
    expect(await screen.findByText('Ends Dec 31')).toBeInTheDocument();
    expect(financeState.requests[0]?.body).toEqual({ endsOn: '2026-12-31' });
    await user.click(await screen.findByRole('button', { name: 'Resume this bill' }));
    await waitFor(() => expect(screen.queryByText('Ends Dec 31')).not.toBeInTheDocument());
    expect(financeState.requests[1]?.body).toEqual({ endsOn: null });
  });

  test('AC: deleting a bill that has charged shows "End the bill instead" and keeps it', async () => {
    const { user, panel } = await openResend();
    await user.click(panel.getByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete Resend?' })).getByRole('button', {
        name: 'Delete expense',
      }),
    );
    expect(
      await screen.findByText('This bill has already charged. End the bill instead.'),
    ).toBeInTheDocument();
    expect(financeState.expenses.some((e) => e.name === 'Resend')).toBe(true);
  });

  test('FR-4: editing a one-off changes the amount and date, and a one-off can be deleted', async () => {
    const user = userEvent.setup();
    renderFinance('?tab=expenses');
    await screen.findByRole('table', { name: 'Expenses' });
    await user.click(screen.getByRole('button', { name: 'Open Terms and privacy review' }));
    const panel = within(
      screen.getByRole('complementary', { name: 'Edit Terms and privacy review' }),
    );
    expect(panel.getByLabelText('Amount (USD)')).toHaveValue('300.00');
    expect(panel.queryByText('Price history')).not.toBeInTheDocument();
    const amount = panel.getByLabelText('Amount (USD)');
    await user.clear(amount);
    await user.type(amount, '350');
    await user.click(panel.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(financeState.requests).toHaveLength(1));
    expect(financeState.requests[0]?.body).toMatchObject({
      amountCents: 35000,
      spentOn: '2026-11-12',
    });

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete expense' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Open Terms and privacy review' }),
      ).not.toBeInTheDocument(),
    );
  });
});

describe('FR-8: Provider invoices tab', () => {
  test('AC: shows metered, invoice or plan, gap, what counts and its source', async () => {
    renderFinance('?tab=invoices');
    const table = within(
      await screen.findByRole('table', { name: 'Provider invoices, November 2026' }),
    );
    const google = table.getByRole('row', { name: /Google Maps Platform/ });
    expect(google).toHaveTextContent('$12.75');
    expect(google).toHaveTextContent('$17.20');
    expect(google).toHaveTextContent('+34.9%');
    expect(google).toHaveTextContent('invoice');
    expect(table.getByRole('row', { name: /Apify/ })).toHaveTextContent('45% of plan used');
    expect(table.getByRole('row', { name: /Apify/ })).toHaveTextContent('plan');
    expect(table.getByRole('row', { name: /Twilio/ })).toHaveTextContent('estimate');
    expect(table.getByRole('row', { name: /^Total/ })).toHaveTextContent('$82.15');
    expect(table.getByRole('row', { name: /^Total/ })).toHaveTextContent('$132.00');
    expect(screen.queryByText('Google Places')).not.toBeInTheDocument();
  });

  test('a flagged row says "Gap" in words, links to the Rate card, and the banner counts it', async () => {
    renderFinance('?tab=invoices');
    const table = within(await screen.findByRole('table', { name: /Provider invoices/ }));
    const google = table.getByRole('row', { name: /Google Maps Platform/ });
    expect(google).toHaveTextContent(
      'Gap: Google Maps Platform billed +34.9% versus the Rate card cost.',
    );
    expect(within(google).getByRole('link', { name: 'Review rate card' })).toHaveAttribute(
      'href',
      '/app/staff/tools',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('1 gap over 15%');
    expect(
      within(table.getByRole('row', { name: /ZeroBounce/ })).queryByRole('link', {
        name: 'Review rate card',
      }),
    ).not.toBeInTheDocument();
  });

  test('AJ-3: entering Twilio $1.50 makes it an invoice, flagged +66.7%, and the banner counts 2', async () => {
    const user = userEvent.setup();
    renderFinance('?tab=invoices');
    await screen.findByRole('table', { name: /Provider invoices/ });
    await user.type(screen.getByLabelText('Twilio invoice for November 2026'), '1.50');
    await user.click(screen.getByRole('button', { name: 'Save Twilio invoice' }));
    const twilio = await waitFor(() => {
      const row = screen.getByRole('row', { name: /Twilio/ });
      expect(row).toHaveTextContent('+66.7%');
      return row;
    });
    expect(twilio).toHaveTextContent('$1.50');
    expect(twilio).toHaveTextContent('invoice');
    expect(twilio).toHaveTextContent('Gap:');
    expect(await screen.findByText('2 gaps over 15%')).toBeInTheDocument();
    expect(financeState.requests).toEqual([
      { method: 'PUT', path: '/provider-invoices/twilio/2026-11', body: { amountCents: 150 } },
    ]);
  });

  test('edits an existing invoice with a note, then removes it to revert to the estimate', async () => {
    const user = userEvent.setup();
    renderFinance('?tab=invoices');
    await screen.findByRole('table', { name: /Provider invoices/ });
    await user.click(screen.getByRole('button', { name: 'Edit Anthropic invoice' }));
    const amount = screen.getByLabelText('Anthropic invoice for November 2026');
    expect(amount).toHaveValue('44.10');
    await user.clear(amount);
    await user.type(amount, '45');
    await user.type(screen.getByLabelText('Anthropic invoice note'), 'Nov statement');
    await user.click(screen.getByRole('button', { name: 'Save Anthropic invoice' }));
    await waitFor(() =>
      expect(screen.getByRole('row', { name: /Anthropic/ })).toHaveTextContent('$45.00'),
    );
    expect(financeState.requests[0]?.body).toEqual({ amountCents: 4500, note: 'Nov statement' });

    await user.click(screen.getByRole('button', { name: 'Edit Anthropic invoice' }));
    await user.click(screen.getByRole('button', { name: 'Remove Anthropic invoice' }));
    await waitFor(() =>
      expect(screen.getByRole('row', { name: /Anthropic/ })).toHaveTextContent('estimate'),
    );
    expect(screen.getByRole('row', { name: /Anthropic/ })).toHaveTextContent('$38.40');
  });

  test('rejects an amount that is not money and shows a save error per row', async () => {
    const user = userEvent.setup();
    renderFinance('?tab=invoices');
    await screen.findByRole('table', { name: /Provider invoices/ });
    await user.type(screen.getByLabelText('Twilio invoice for November 2026'), 'x');
    await user.click(screen.getByRole('button', { name: 'Save Twilio invoice' }));
    expect(await screen.findByText('Enter an amount like 49.00')).toBeInTheDocument();

    server.use(http.put('*/api/staff/finance/provider-invoices/:provider/:month', serverError));
    await user.clear(screen.getByLabelText('Twilio invoice for November 2026'));
    await user.type(screen.getByLabelText('Twilio invoice for November 2026'), '2');
    await user.click(screen.getByRole('button', { name: 'Save Twilio invoice' }));
    expect(await screen.findByText('Could not save. Try again.')).toBeInTheDocument();
  });

  test('mobile: providers are cards with the same figures and the gap flag', async () => {
    stubMobile();
    renderFinance('?tab=invoices');
    const list = within(
      await screen.findByRole('list', { name: 'Provider invoices, November 2026, as cards' }),
    );
    expect(list.getAllByRole('listitem')).toHaveLength(6);
    const google = within(
      list.getByText('Google Maps Platform', { selector: 'span' }).closest('li')!,
    );
    expect(google.getByText('$17.20')).toBeInTheDocument();
    expect(google.getByText('+34.9%')).toBeInTheDocument();
    expect(google.getByRole('link', { name: 'Review rate card' })).toBeInTheDocument();
    expect(screen.getByText('Counts in P&L').nextElementSibling).toHaveTextContent('$132.00');
  });

  test('"No provider usage in <Month>." when there are no rows', async () => {
    financeState.rows = [];
    renderFinance('?tab=invoices');
    expect(await screen.findByText('No provider usage in November 2026.')).toBeInTheDocument();
  });

  test('shows loading and an error with Retry', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.get('*/api/staff/finance/provider-invoices', () => {
        calls += 1;
        if (calls === 1) return serverError();
        return HttpResponse.json({
          month: '2026-11',
          rows: seedInvoiceRows(),
          totals: {
            metered: { cents: 8215, currency: 'usd' },
            counted: { cents: 13200, currency: 'usd' },
          },
          flaggedCount: 1,
        });
      }),
    );
    renderFinance('?tab=invoices');
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: /Provider invoices/ })).toBeInTheDocument();
  });
});

describe('month and tab params', () => {
  test('?month is clamped to November 2026 .. the current month', () => {
    expect(resolveMonth('2026-10', '2026-11')).toBe('2026-11');
    expect(resolveMonth('2026-12', '2026-11')).toBe('2026-11');
    expect(resolveMonth('garbage', '2026-11')).toBe('2026-11');
    expect(resolveMonth('2026-11', '2027-02')).toBe('2026-11');
    expect(resolveMonth('2027-01', '2027-02')).toBe('2027-01');
    expect(resolveMonth(null, '2026-11')).toBe('2026-11');
  });

  test('the selector runs from November 2026 to the current month', () => {
    expect(monthRange('2026-11')).toEqual(['2026-11']);
    expect(monthRange('2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(currentMonth(new Date('2026-12-05T00:00:00Z'))).toBe('2026-12');
  });

  test('an unknown ?tab falls back to the P&L tab', async () => {
    renderFinance('?tab=nope&month=2026-11');
    expect(
      await screen.findByRole('table', { name: 'Profit and loss statement' }),
    ).toBeInTheDocument();
  });
});

describe('formatting', () => {
  test('money uses a real minus sign and no negative zero', () => {
    expect(formatMoney(52275)).toBe('$522.75');
    expect(formatMoney(-32575)).toBe(`${MINUS}$325.75`);
    expect(formatMoney(-0)).toBe('$0.00');
  });

  test('dollars typed by Staff become cents or NaN', () => {
    expect(dollarsToCents('49')).toBe(4900);
    expect(dollarsToCents('$1,049.50')).toBe(104950);
    expect(dollarsToCents('0.1')).toBe(10);
    expect(dollarsToCents('1.234')).toBeNaN();
    expect(dollarsToCents('abc')).toBeNaN();
  });
});
