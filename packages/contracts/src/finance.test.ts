import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type { Contract } from './common.js';
import {
  CATEGORIES,
  addExpensePrice,
  category,
  categoryLabels,
  createExpense,
  deleteExpense,
  deleteExpensePrice,
  deleteProviderInvoice,
  exportPnlCsv,
  financeContracts,
  financeTestContracts,
  getBudget,
  getPnl,
  listExpenses,
  listProviderInvoices,
  listProviders,
  month,
  oneOffExpensePatch,
  providerAlreadyCoveredError,
  providerKeyOf,
  recurringExpensePatch,
  runBudgetCheck,
  saveBudget,
  saveProviderInvoice,
  updateExpense,
  type Expense,
  type Pnl,
  type ProviderRow,
} from './finance.js';

const usd = (cents: number) => ({ cents, currency: 'usd' as const });
const at = '2026-11-20T12:00:00.000Z';
const expenseId = '0193a1b2-0000-7000-8000-0000000000e1';
const staff = { id: '0193a1b2-0000-7000-8000-000000000002', email: 'staff@demo.test' };

const recurring: Expense = {
  id: expenseId,
  kind: 'recurring',
  name: 'Resend',
  vendor: 'Resend',
  category: 'email',
  amount: usd(2000),
  cadence: 'monthly',
  startsOn: '2026-11-18',
  endsOn: null,
  nextChargeOn: '2026-12-18',
  status: 'active',
  coversProvider: null,
  link: 'https://resend.com/settings/billing',
  notes: null,
  monthlyEquivalent: usd(2000),
  versions: [
    { effectiveFrom: '2026-11-18', amount: usd(2000) },
    { effectiveFrom: '2026-12-18', amount: usd(2500) },
  ],
  chargesInMonth: [{ date: '2026-11-18', amount: usd(2000) }],
  createdAt: at,
  updatedAt: at,
};

const providerRow: ProviderRow = {
  provider: { key: 'google-maps-platform', name: 'Google Maps Platform' },
  category: 'data_providers',
  metered: usd(1275),
  invoice: { amount: usd(1720), note: null, enteredAt: at, enteredBy: staff },
  plan: null,
  counted: { source: 'invoice', amount: usd(1720) },
  gapPct: 34.9,
  planUsedPct: null,
  flagged: true,
};

const trend = Array.from({ length: 12 }, (_, i) => {
  const m = `${i < 1 ? 2025 : 2026}-${String(((i + 11) % 12) + 1).padStart(2, '0')}`;
  return m === '2026-11'
    ? { month: m, revenue: usd(19700), expenses: usd(52275), net: usd(-32575) }
    : { month: m, revenue: null, expenses: null, net: null };
});

const novemberPnl: Pnl = {
  month: '2026-11',
  monthToDate: true,
  revenue: { sales: usd(19700), salesCount: 3, refunds: usd(0), net: usd(19700) },
  costOfRevenue: {
    lines: [
      { category: 'ai', label: 'AI', amount: usd(4410), source: 'providers' },
      {
        category: 'data_providers',
        label: 'Data providers',
        amount: usd(8790),
        source: 'providers',
      },
      {
        category: 'payments_fees',
        label: 'Stripe fees (estimated, 2.9% + 30¢ per sale)',
        amount: usd(661),
        source: 'stripe_fees',
      },
    ],
    total: usd(13861),
  },
  grossProfit: usd(5839),
  grossMarginPct: 29.6,
  operating: {
    lines: [
      { category: 'legal_admin', amount: usd(30000) },
      { category: 'hosting', amount: usd(4215) },
    ],
    total: usd(38414),
  },
  netProfit: usd(-32575),
  totalExpenses: usd(52275),
  categories: [{ category: 'legal_admin', amount: usd(30000), sharePct: 57.4 }],
  yearlyThisMonth: [
    { expenseId, name: 'llyner.com', amount: usd(1499), monthlyEquivalent: usd(125) },
  ],
  fixedRunRate: usd(13540),
  budget: {
    amount: usd(30000),
    spent: usd(52275),
    pct: 174,
    status: 'over',
    alertsSent: [80, 100],
  },
  providerFlags: 1,
  trend,
};

const ok = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;

describe('contracts: finance conventions', () => {
  test('Month is YYYY-MM', () => {
    expect(ok(month, '2026-11')).toBe(true);
    for (const bad of ['2026-13', '2026-1', '2026-11-01', 'november']) {
      expect(ok(month, bad)).toBe(false);
    }
  });

  test('ten categories in order, each with a label', () => {
    expect(category.options).toEqual(CATEGORIES.map((c) => c.key));
    expect(category.options).toHaveLength(10);
    expect(categoryLabels.domain_dns).toBe('Domain & DNS');
  });

  test('FR-6: provider keys are the slug of the catalog name', () => {
    expect(providerKeyOf('Google Maps Platform')).toBe('google-maps-platform');
    expect(providerKeyOf('ZeroBounce')).toBe('zerobounce');
    expect(providerKeyOf('OpenStreetMap')).toBe('openstreetmap');
  });
});

describe('FR-1: expenses list', () => {
  test('query filters and the includeEnded flag', () => {
    expect(listExpenses.query.parse({})).toEqual({ includeEnded: false });
    expect(listExpenses.query.parse({ includeEnded: 'true', kind: 'one_off' })).toMatchObject({
      includeEnded: true,
      kind: 'one_off',
    });
    expect(listExpenses.query.parse({ includeEnded: 'false' }).includeEnded).toBe(false);
    expect(ok(listExpenses.query, { category: 'food' })).toBe(false);
    expect(ok(listExpenses.query, { month: '2026-1' })).toBe(false);
  });

  test('response with totals', () => {
    const body = {
      month: '2026-11',
      items: [recurring],
      totals: { fixedRunRate: usd(13540), chargesInMonth: usd(44914) },
    };
    expect(ok(listExpenses.response, body)).toBe(true);
    expect(
      ok(listExpenses.response, { ...body, items: [{ ...recurring, status: 'paused' }] }),
    ).toBe(false);
  });
});

describe('FR-2, FR-4: add an expense', () => {
  const bill = {
    kind: 'recurring',
    name: 'Apify Starter',
    vendor: 'Apify',
    category: 'data_providers',
    amountCents: 4900,
    cadence: 'monthly',
    startsOn: '2026-11-03',
    coversProvider: 'apify',
    link: 'https://apify.com/billing',
  };
  const oneOff = {
    kind: 'one_off',
    name: 'Terms and privacy review',
    vendor: 'Counsel',
    category: 'legal_admin',
    amountCents: 30000,
    spentOn: '2026-11-12',
  };

  test('valid Recurring bills and One-offs', () => {
    expect(ok(createExpense.body, bill)).toBe(true);
    expect(ok(createExpense.body, oneOff)).toBe(true);
    expect(ok(createExpense.response, recurring)).toBe(true);
    expect(createExpense.status).toBe(201);
  });

  test('rejected inputs', () => {
    expect(ok(createExpense.body, { ...bill, amountCents: 0 })).toBe(false);
    expect(ok(createExpense.body, { ...bill, amountCents: 10_000_001 })).toBe(false);
    expect(ok(createExpense.body, { ...bill, amountCents: 12.5 })).toBe(false);
    expect(ok(createExpense.body, { ...bill, name: '' })).toBe(false);
    expect(ok(createExpense.body, { ...bill, name: 'x'.repeat(81) })).toBe(false);
    expect(ok(createExpense.body, { ...bill, cadence: 'weekly' })).toBe(false);
    expect(ok(createExpense.body, { ...bill, link: 'http://apify.com' })).toBe(false);
    expect(ok(createExpense.body, { ...bill, notes: 'x'.repeat(501) })).toBe(false);
    expect(ok(createExpense.body, { ...bill, coversProvider: 'Google Maps' })).toBe(false);
    expect(ok(createExpense.body, { ...oneOff, spentOn: '12/11/2026' })).toBe(false);
    expect(ok(createExpense.body, { ...oneOff, kind: 'weekly' })).toBe(false);
  });

  test('endsOn before startsOn is a 400 on endsOn', () => {
    const r = createExpense.body.safeParse({ ...bill, endsOn: '2026-11-01' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['endsOn']);
    expect(ok(createExpense.body, { ...bill, endsOn: '2026-11-03' })).toBe(true);
  });

  test('documented errors, PROVIDER_ALREADY_COVERED names the other bill', () => {
    const codes = createExpense.errors.map((e) => `${e.status} ${e.code}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        '404 UNKNOWN_PROVIDER',
        '409 PROVIDER_ALREADY_COVERED',
        '422 BEFORE_HISTORY_START',
        '422 COVERS_PROVIDER_CATEGORY',
        '403 TWO_FACTOR_REQUIRED',
      ]),
    );
    expect(
      ok(providerAlreadyCoveredError, {
        error: {
          code: 'PROVIDER_ALREADY_COVERED',
          message: 'Apify Starter already covers Apify',
          details: { expenseId, name: 'Apify Starter' },
        },
      }),
    ).toBe(true);
  });
});

describe('FR-3: edit, price change, delete', () => {
  test('PATCH takes at least one known field; null clears', () => {
    expect(ok(updateExpense.body, { endsOn: '2026-11-30' })).toBe(true);
    expect(ok(updateExpense.body, { endsOn: null, coversProvider: null, link: null })).toBe(true);
    expect(ok(updateExpense.body, {})).toBe(false);
    expect(ok(updateExpense.body, { price: 100 })).toBe(false);
  });

  test('per-kind patches: amount only on One-offs, endsOn only on bills', () => {
    expect(ok(recurringExpensePatch, { amountCents: 2500 })).toBe(false);
    expect(ok(recurringExpensePatch, { endsOn: '2026-12-31' })).toBe(true);
    expect(ok(oneOffExpensePatch, { amountCents: 2500, spentOn: '2026-11-14' })).toBe(true);
    expect(ok(oneOffExpensePatch, { endsOn: '2026-12-31' })).toBe(false);
  });

  test('price versions', () => {
    expect(ok(addExpensePrice.body, { effectiveFrom: '2026-12-18', amountCents: 2500 })).toBe(true);
    expect(ok(addExpensePrice.body, { effectiveFrom: '2026-12-18' })).toBe(false);
    expect(addExpensePrice.errors.map((e) => e.code)).toEqual(
      expect.arrayContaining(['NOT_FOUND', 'NOT_RECURRING', 'EFFECTIVE_BEFORE_START']),
    );
    expect(ok(deleteExpensePrice.params, { id: expenseId, effectiveFrom: '2026-12-18' })).toBe(
      true,
    );
    expect(ok(deleteExpensePrice.params, { id: expenseId, effectiveFrom: 'first' })).toBe(false);
    expect(deleteExpensePrice.errors.map((e) => e.code)).toContain('FIRST_VERSION');
  });

  test('delete is 204 or 409 HAS_CHARGES', () => {
    expect(deleteExpense.status).toBe(204);
    expect(deleteExpense.errors.map((e) => e.code)).toContain('HAS_CHARGES');
  });
});

describe('FR-6, FR-8: providers and Provider invoices', () => {
  test('providers for the picker', () => {
    const body = {
      items: [{ key: 'anthropic', name: 'Anthropic', category: 'ai' }],
    };
    expect(ok(listProviders.response, body)).toBe(true);
    expect(
      ok(listProviders.response, {
        items: [{ key: 'anthropic', name: 'Anthropic', category: 'email' }],
      }),
    ).toBe(false);
  });

  test('a month of rows', () => {
    const body = {
      month: '2026-11',
      rows: [providerRow],
      totals: { metered: usd(1275), counted: usd(1720) },
      flaggedCount: 1,
    };
    expect(ok(listProviderInvoices.response, body)).toBe(true);
    expect(
      ok(listProviderInvoices.response, {
        ...body,
        rows: [{ ...providerRow, counted: { source: 'rate_card', amount: usd(1) } }],
      }),
    ).toBe(false);
  });

  test('save and delete an invoice', () => {
    expect(ok(saveProviderInvoice.params, { provider: 'twilio', month: '2026-11' })).toBe(true);
    expect(ok(saveProviderInvoice.params, { provider: 'Twilio', month: '2026-11' })).toBe(false);
    expect(ok(saveProviderInvoice.body, { amountCents: 0 })).toBe(true);
    expect(ok(saveProviderInvoice.body, { amountCents: 150, note: 'Nov invoice' })).toBe(true);
    expect(ok(saveProviderInvoice.body, { amountCents: -1 })).toBe(false);
    expect(ok(saveProviderInvoice.body, { amountCents: 1, note: 'x'.repeat(201) })).toBe(false);
    expect(ok(saveProviderInvoice.response, providerRow)).toBe(true);
    expect(ok(deleteProviderInvoice.response, { ...providerRow, invoice: null })).toBe(true);
    expect(deleteProviderInvoice.errors.map((e) => `${e.status} ${e.code}`)).toEqual(
      expect.arrayContaining(['404 NO_INVOICE', '422 FUTURE_MONTH']),
    );
  });
});

describe('FR-9, FR-11: P&L and Budget', () => {
  test('the seeded November P&L parses; negative net allowed', () => {
    expect(getPnl.response.parse(novemberPnl)).toEqual(novemberPnl);
    expect(getPnl.query.parse({})).toEqual({});
    expect(getPnl.errors.map((e) => e.code)).toEqual(
      expect.arrayContaining(['BEFORE_HISTORY_START', 'FUTURE_MONTH']),
    );
  });

  test('the trend has 12 months and costs are not negative', () => {
    expect(ok(getPnl.response, { ...novemberPnl, trend: trend.slice(1) })).toBe(false);
    expect(ok(getPnl.response, { ...novemberPnl, totalExpenses: usd(-1) })).toBe(false);
    expect(
      ok(getPnl.response, { ...novemberPnl, budget: { ...novemberPnl.budget, alertsSent: [50] } }),
    ).toBe(false);
  });

  test('Budget get and save', () => {
    expect(
      ok(getBudget.response, { monthlyBudget: usd(30000), updatedAt: at, updatedBy: null }),
    ).toBe(true);
    expect(ok(saveBudget.body, { monthlyBudgetCents: 0 })).toBe(true);
    expect(ok(saveBudget.body, { monthlyBudgetCents: 10_000_001 })).toBe(false);
    expect(ok(saveBudget.body, { monthlyBudgetCents: '600' })).toBe(false);
  });
});

describe('FR-10: CSV export', () => {
  test('from..to within 24 months', () => {
    expect(exportPnlCsv.contentType).toBe('text/csv');
    expect(ok(exportPnlCsv.query, { from: '2026-11', to: '2026-11' })).toBe(true);
    expect(ok(exportPnlCsv.query, { from: '2026-12', to: '2026-11' })).toBe(false);
    expect(ok(exportPnlCsv.query, { from: '2026-11', to: '2028-10' })).toBe(true);
    expect(ok(exportPnlCsv.query, { from: '2026-11', to: '2028-11' })).toBe(false);
    expect(ok(exportPnlCsv.query, { from: '2026-11' })).toBe(false);
  });
});

describe('FR-12: test-only budget check', () => {
  test('returns the thresholds sent', () => {
    expect(ok(runBudgetCheck.response, { sent: [100] })).toBe(true);
    expect(ok(runBudgetCheck.response, { sent: [90] })).toBe(false);
  });
});

const all: Record<string, Contract> = { ...financeContracts, ...financeTestContracts };

describe('contracts: finance coverage of prd-expenses section 7', () => {
  test('every endpoint has exactly one contract', () => {
    const keys = Object.values(all).map((c) => `${c.method} ${c.path}`);
    expect([...keys].sort()).toEqual(
      [
        'GET /api/staff/finance/expenses',
        'POST /api/staff/finance/expenses',
        'PATCH /api/staff/finance/expenses/:id',
        'POST /api/staff/finance/expenses/:id/prices',
        'DELETE /api/staff/finance/expenses/:id/prices/:effectiveFrom',
        'DELETE /api/staff/finance/expenses/:id',
        'GET /api/staff/finance/providers',
        'GET /api/staff/finance/provider-invoices',
        'PUT /api/staff/finance/provider-invoices/:provider/:month',
        'DELETE /api/staff/finance/provider-invoices/:provider/:month',
        'GET /api/staff/finance/pnl',
        'GET /api/staff/finance/pnl.csv',
        'GET /api/staff/finance/budget',
        'PUT /api/staff/finance/budget',
        'POST /api/test/jobs/budget-check',
      ].sort(),
    );
  });

  test.each(Object.entries(financeContracts))('%s is Staff only', (_name, c) => {
    expect(c.auth).toBe('staff');
    const codes = c.errors.map((e) => `${e.status} ${e.code}`);
    expect(codes).toEqual(expect.arrayContaining(['401 UNAUTHENTICATED', '403 FORBIDDEN']));
  });

  test.each(Object.entries(all))('%s schemas convert to JSON Schema', (_name, c) => {
    for (const schema of [c.body, c.query, c.params]) {
      if (schema) expect(() => z.toJSONSchema(schema, { io: 'input' })).not.toThrow();
    }
    expect(() => z.toJSONSchema(c.response, { io: 'output' })).not.toThrow();
  });

  test.each(Object.entries(all))('%s path params match its params schema', (_name, c) => {
    const names = [...c.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]);
    const shape = c.params instanceof z.ZodObject ? Object.keys(c.params.shape) : [];
    expect(shape.sort()).toEqual(names.sort());
  });
});
