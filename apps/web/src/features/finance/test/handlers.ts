import {
  addExpensePrice,
  addPriceBody,
  budget as budgetShape,
  createExpense,
  createExpenseBody,
  deleteExpensePrice,
  deleteProviderInvoice,
  getBudget,
  getPnl,
  listExpenses,
  listProviderInvoices,
  listProviders,
  providerAlreadyCoveredError,
  saveBudget,
  saveBudgetBody,
  saveInvoiceBody,
  saveProviderInvoice,
  updateExpense,
  updateExpenseBody,
  type Expense,
  type Pnl,
  type ProviderRow,
} from '@app/contracts/finance';
import { errorResponse } from '@app/contracts/errors';
import { http, HttpResponse } from 'msw';
import {
  emptyPnl,
  ids,
  novemberPnl,
  providers,
  seedExpenses,
  seedInvoiceRows,
  usd,
} from './fixtures';

/** The fixed "today" of the tests (the PRD's clock). */
export const TODAY = '2026-11-20';

export interface Recorded {
  method: string;
  path: string;
  body: unknown;
}

export const financeState: {
  expenses: Expense[];
  rows: ProviderRow[];
  pnl: Pnl;
  budgetCents: number;
  requests: Recorded[];
} = { expenses: [], rows: [], pnl: novemberPnl(), budgetCents: 30000, requests: [] };

export function resetFinanceState() {
  financeState.expenses = seedExpenses();
  financeState.rows = seedInvoiceRows();
  financeState.pnl = novemberPnl();
  financeState.budgetCents = 30000;
  financeState.requests = [];
}
resetFinanceState();

const fail = (status: number, code: string, message: string, extra: object = {}) =>
  HttpResponse.json(errorResponse.parse({ error: { code, message, ...extra } }), { status });

const invalid = (fields: Record<string, string>) =>
  fail(400, 'VALIDATION_ERROR', 'Invalid', { fields });

const record = (method: string, path: string, body: unknown) =>
  financeState.requests.push({ method, path, body });

function countedAfter(row: ProviderRow): ProviderRow {
  if (row.invoice) {
    const gap =
      row.metered.cents > 0
        ? Math.round(((row.invoice.amount.cents - row.metered.cents) / row.metered.cents) * 1000) /
          10
        : null;
    return {
      ...row,
      counted: { source: 'invoice', amount: row.invoice.amount },
      gapPct: gap,
      planUsedPct: null,
      flagged: gap === null ? row.invoice.amount.cents > 0 : Math.abs(gap) > 15,
    };
  }
  if (row.plan) {
    return {
      ...row,
      counted: { source: 'plan', amount: row.plan.amount },
      gapPct: null,
      planUsedPct: Math.round((row.metered.cents / row.plan.amount.cents) * 100),
      flagged: false,
    };
  }
  return {
    ...row,
    counted: { source: 'estimate', amount: row.metered },
    gapPct: null,
    flagged: false,
  };
}

const rowsResponse = () => {
  const rows = financeState.rows;
  return listProviderInvoices.response.parse({
    month: '2026-11',
    rows,
    totals: {
      metered: usd(rows.reduce((n, r) => n + r.metered.cents, 0)),
      counted: usd(rows.reduce((n, r) => n + r.counted.amount.cents, 0)),
    },
    flaggedCount: rows.filter((r) => r.flagged).length,
  });
};

export const handlers = [
  http.get('*/api/staff/finance/pnl', ({ request }) => {
    const month = new URL(request.url).searchParams.get('month') ?? '2026-11';
    const pnl = month === '2026-11' ? financeState.pnl : emptyPnl(month);
    return HttpResponse.json(getPnl.response.parse(pnl));
  }),

  http.get('*/api/staff/finance/budget', () =>
    HttpResponse.json(
      getBudget.response.parse({
        monthlyBudget: usd(financeState.budgetCents),
        updatedAt: '2026-11-01T00:00:00.000Z',
        updatedBy: null,
      }),
    ),
  ),

  http.put('*/api/staff/finance/budget', async ({ request }) => {
    const body: unknown = await request.json();
    const parsed = saveBudgetBody.safeParse(body);
    if (!parsed.success) return invalid({ monthlyBudgetCents: 'Invalid' });
    record('PUT', '/budget', body);
    const cents = parsed.data.monthlyBudgetCents;
    financeState.budgetCents = cents;
    const spent = financeState.pnl.budget.spent.cents;
    const pct = cents === 0 ? null : Math.round((spent / cents) * 100);
    financeState.pnl = {
      ...financeState.pnl,
      budget: {
        ...financeState.pnl.budget,
        amount: usd(cents),
        pct,
        status: pct === null || pct >= 100 ? 'over' : pct >= 80 ? 'near' : 'under',
      },
    };
    return HttpResponse.json(
      saveBudget.response.parse(
        budgetShape.parse({
          monthlyBudget: usd(cents),
          updatedAt: '2026-11-20T12:00:00.000Z',
          updatedBy: null,
        }),
      ),
    );
  }),

  http.get('*/api/staff/finance/providers', () =>
    HttpResponse.json(listProviders.response.parse({ items: providers })),
  ),

  http.get('*/api/staff/finance/expenses', ({ request }) => {
    const q = new URL(request.url).searchParams;
    const category = q.get('category');
    const kind = q.get('kind');
    const includeEnded = q.get('includeEnded') === 'true';
    const items = financeState.expenses.filter(
      (e) =>
        (!category || e.category === category) &&
        (!kind || e.kind === kind) &&
        (includeEnded || e.status !== 'ended'),
    );
    return HttpResponse.json(
      listExpenses.response.parse({
        month: q.get('month') ?? '2026-11',
        items,
        totals: { fixedRunRate: usd(13540), chargesInMonth: usd(52275) },
      }),
    );
  }),

  http.post('*/api/staff/finance/expenses', async ({ request }) => {
    const body: unknown = await request.json();
    const parsed = createExpenseBody.safeParse(body);
    if (!parsed.success) return invalid({ name: 'Invalid' });
    const b = parsed.data;
    if (b.kind === 'one_off' && b.spentOn > TODAY) {
      return invalid({ spentOn: "Date can't be in the future" });
    }
    if (b.kind === 'recurring' && b.coversProvider) {
      const other = financeState.expenses.find((e) => e.coversProvider?.key === b.coversProvider);
      if (other) {
        return HttpResponse.json(
          providerAlreadyCoveredError.parse({
            error: {
              code: 'PROVIDER_ALREADY_COVERED',
              message: 'Already covered',
              details: { expenseId: other.id, name: other.name },
            },
          }),
          { status: 409 },
        );
      }
    }
    record('POST', '/expenses', body);
    const id = `0193a1b2-0000-7000-8000-${String(financeState.expenses.length + 100).padStart(12, '0')}`;
    const covers =
      b.kind === 'recurring' && b.coversProvider
        ? providers.find((p) => p.key === b.coversProvider)
        : undefined;
    const created: Expense = {
      id,
      kind: b.kind,
      name: b.name,
      vendor: b.vendor,
      category: b.category,
      amount: usd(b.amountCents),
      cadence: b.kind === 'recurring' ? b.cadence : null,
      startsOn: b.kind === 'recurring' ? b.startsOn : b.spentOn,
      endsOn: b.kind === 'recurring' ? (b.endsOn ?? null) : null,
      nextChargeOn: b.kind === 'recurring' ? '2026-12-20' : null,
      status: 'active',
      coversProvider: covers ? { key: covers.key, name: covers.name } : null,
      link: b.link ?? null,
      notes: b.notes ?? null,
      monthlyEquivalent: b.kind === 'recurring' ? usd(b.amountCents) : null,
      versions:
        b.kind === 'recurring' ? [{ effectiveFrom: b.startsOn, amount: usd(b.amountCents) }] : [],
      chargesInMonth: [],
      createdAt: '2026-11-20T12:00:00.000Z',
      updatedAt: '2026-11-20T12:00:00.000Z',
    };
    financeState.expenses = [...financeState.expenses, created];
    return HttpResponse.json(createExpense.response.parse(created), { status: 201 });
  }),

  http.patch('*/api/staff/finance/expenses/:id', async ({ params, request }) => {
    const body: unknown = await request.json();
    const parsed = updateExpenseBody.safeParse(body);
    if (!parsed.success) return invalid({ name: 'Invalid' });
    const id = String(params.id);
    const current = financeState.expenses.find((e) => e.id === id);
    if (!current) return fail(404, 'NOT_FOUND', 'No expense');
    record('PATCH', `/expenses/${id}`, body);
    const p = parsed.data;
    const updated: Expense = {
      ...current,
      ...(p.name !== undefined && { name: p.name }),
      ...(p.vendor !== undefined && { vendor: p.vendor }),
      ...(p.category !== undefined && { category: p.category }),
      ...(p.link !== undefined && { link: p.link }),
      ...(p.notes !== undefined && { notes: p.notes }),
      ...(p.amountCents !== undefined && { amount: usd(p.amountCents) }),
      ...(p.spentOn !== undefined && { startsOn: p.spentOn }),
      ...(p.endsOn !== undefined && {
        endsOn: p.endsOn,
        status: p.endsOn === null ? ('active' as const) : ('ending' as const),
      }),
      updatedAt: new Date().toISOString(),
    };
    financeState.expenses = financeState.expenses.map((e) => (e.id === id ? updated : e));
    return HttpResponse.json(updateExpense.response.parse(updated));
  }),

  http.post('*/api/staff/finance/expenses/:id/prices', async ({ params, request }) => {
    const body: unknown = await request.json();
    const parsed = addPriceBody.safeParse(body);
    if (!parsed.success) return invalid({ effectiveFrom: 'Invalid' });
    const id = String(params.id);
    const current = financeState.expenses.find((e) => e.id === id);
    if (!current) return fail(404, 'NOT_FOUND', 'No expense');
    if (parsed.data.effectiveFrom < current.startsOn) {
      return fail(422, 'EFFECTIVE_BEFORE_START', 'Before start');
    }
    record('POST', `/expenses/${id}/prices`, body);
    const versions = [
      ...current.versions.filter((v) => v.effectiveFrom !== parsed.data.effectiveFrom),
      { effectiveFrom: parsed.data.effectiveFrom, amount: usd(parsed.data.amountCents) },
    ].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    const updated = { ...current, versions, updatedAt: new Date().toISOString() };
    financeState.expenses = financeState.expenses.map((e) => (e.id === id ? updated : e));
    return HttpResponse.json(addExpensePrice.response.parse(updated), { status: 201 });
  }),

  http.delete('*/api/staff/finance/expenses/:id/prices/:effectiveFrom', ({ params }) => {
    const id = String(params.id);
    const current = financeState.expenses.find((e) => e.id === id);
    if (!current) return fail(404, 'NOT_FOUND', 'No expense');
    if (current.versions[0]?.effectiveFrom === params.effectiveFrom) {
      return fail(409, 'FIRST_VERSION', 'First version');
    }
    record('DELETE', `/expenses/${id}/prices/${String(params.effectiveFrom)}`, null);
    const updated = {
      ...current,
      versions: current.versions.filter((v) => v.effectiveFrom !== params.effectiveFrom),
      updatedAt: new Date().toISOString(),
    };
    financeState.expenses = financeState.expenses.map((e) => (e.id === id ? updated : e));
    return HttpResponse.json(deleteExpensePrice.response.parse(updated));
  }),

  http.delete('*/api/staff/finance/expenses/:id', ({ params }) => {
    const id = String(params.id);
    const current = financeState.expenses.find((e) => e.id === id);
    if (!current) return fail(404, 'NOT_FOUND', 'No expense');
    if (current.kind === 'recurring' && current.chargesInMonth.length > 0) {
      return fail(409, 'HAS_CHARGES', 'End the bill instead');
    }
    record('DELETE', `/expenses/${id}`, null);
    financeState.expenses = financeState.expenses.filter((e) => e.id !== id);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('*/api/staff/finance/provider-invoices', () => HttpResponse.json(rowsResponse())),

  http.put(
    '*/api/staff/finance/provider-invoices/:provider/:month',
    async ({ params, request }) => {
      const body: unknown = await request.json();
      const parsed = saveInvoiceBody.safeParse(body);
      if (!parsed.success) return invalid({ amountCents: 'Invalid' });
      const key = String(params.provider);
      const row = financeState.rows.find((r) => r.provider.key === key);
      if (!row) return fail(404, 'UNKNOWN_PROVIDER', 'Unknown provider');
      record('PUT', `/provider-invoices/${key}/${String(params.month)}`, body);
      const updated = countedAfter({
        ...row,
        invoice: {
          amount: usd(parsed.data.amountCents),
          note: parsed.data.note ?? null,
          enteredAt: '2026-11-20T12:00:00.000Z',
          enteredBy: { id: ids.legal, email: 'staff@demo.test' },
        },
      });
      financeState.rows = financeState.rows.map((r) => (r.provider.key === key ? updated : r));
      return HttpResponse.json(saveProviderInvoice.response.parse(updated));
    },
  ),

  http.delete('*/api/staff/finance/provider-invoices/:provider/:month', ({ params }) => {
    const key = String(params.provider);
    const row = financeState.rows.find((r) => r.provider.key === key);
    if (!row) return fail(404, 'UNKNOWN_PROVIDER', 'Unknown provider');
    if (!row.invoice) return fail(404, 'NO_INVOICE', 'No invoice');
    record('DELETE', `/provider-invoices/${key}/${String(params.month)}`, null);
    const updated = countedAfter({ ...row, invoice: null });
    financeState.rows = financeState.rows.map((r) => (r.provider.key === key ? updated : r));
    return HttpResponse.json(deleteProviderInvoice.response.parse(updated));
  }),
];
