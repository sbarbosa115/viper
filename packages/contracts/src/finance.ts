import { z } from 'zod';
import {
  defineContract,
  email,
  err,
  id,
  idParams,
  isoDate,
  isoDateTime,
  money,
  noContent,
} from './common.js';

/**
 * finance: Expenses, Provider invoices, the P&L and the Budget (prd-expenses section 7). Staff
 * only. Money is integer cents (USD). Month range rules (≥ 2026-11, ≤ the current month) need the
 * clock, so they are checked by the use cases (422 BEFORE_HISTORY_START / FUTURE_MONTH); the
 * schemas here check formats and fixed limits (400).
 */

// Conventions --------------------------------------------------------------------------------------

/** The first month that can be viewed or written (the history start). */
export const HISTORY_START_MONTH = '2026-11';
export const HISTORY_START_DATE = '2026-11-01';

/** Anything Staff type in: $0.01 to $100,000.00. */
export const MAX_AMOUNT_CENTS = 10_000_000;

/** A calendar month in UTC, `YYYY-MM`. */
export const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-11');
export type Month = z.infer<typeof month>;

/** The ten fixed categories, in display order, with their labels (FR conventions). */
export const CATEGORIES = [
  { key: 'hosting', label: 'Hosting' },
  { key: 'data_providers', label: 'Data providers' },
  { key: 'ai', label: 'AI' },
  { key: 'email', label: 'Email' },
  { key: 'domain_dns', label: 'Domain & DNS' },
  { key: 'payments_fees', label: 'Payments fees' },
  { key: 'software_tools', label: 'Software & tools' },
  { key: 'legal_admin', label: 'Legal & admin' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'other', label: 'Other' },
] as const;

export const category = z.enum([
  'hosting',
  'data_providers',
  'ai',
  'email',
  'domain_dns',
  'payments_fees',
  'software_tools',
  'legal_admin',
  'marketing',
  'other',
]);
export type Category = z.infer<typeof category>;

export const categoryLabels: Readonly<Record<Category, string>> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c.label]),
) as Record<Category, string>;

/** Cost of revenue; every other category is an operating expense. */
export const COST_OF_REVENUE_CATEGORIES: readonly Category[] = [
  'data_providers',
  'ai',
  'payments_fees',
];

/** A provider's category: Anthropic → `ai`, every other provider → `data_providers` (FR-6). */
export const providerCategory = z.enum(['ai', 'data_providers']);
export type ProviderCategory = z.infer<typeof providerCategory>;

/** Categories a bill may have when it covers a provider's usage (FR-2). */
export const COVERS_PROVIDER_CATEGORIES: readonly Category[] = providerCategory.options;

/** A provider's key: its Tool catalog name lowercased, non-alphanumerics as `-` (FR-6). */
export const providerKey = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Unknown provider')
  .max(64);
export type ProviderKey = z.infer<typeof providerKey>;

/** `Google Maps Platform` → `google-maps-platform` (runs of other characters become one `-`). */
export function providerKeyOf(name: string): ProviderKey {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Money that may be negative (gross and net profit, refund-heavy revenue). */
export const signedMoney = z.object({ cents: z.int(), currency: z.literal('usd') });
export type SignedMoney = z.infer<typeof signedMoney>;

const staffRef = z.object({ id, email });

// Inputs ---------------------------------------------------------------------------------------------

const amountCents = z.int().min(1).max(MAX_AMOUNT_CENTS);
const name = z.string().trim().min(1).max(80);
const vendor = z.string().trim().min(1).max(80);
/** https only, at most 2048 characters (NFR-2). */
const link = z
  .string()
  .trim()
  .max(2048)
  .pipe(z.url({ protocol: /^https$/, error: 'Use an https:// link' }));
const notes = z.string().trim().max(500);

export const expenseKind = z.enum(['recurring', 'one_off']);
export type ExpenseKind = z.infer<typeof expenseKind>;

export const cadence = z.enum(['monthly', 'yearly']);
export type Cadence = z.infer<typeof cadence>;

export const expenseStatus = z.enum(['active', 'ending', 'ended']);
export type ExpenseStatus = z.infer<typeof expenseStatus>;

const END_BEFORE_START = "End date can't be before the start date";

/**
 * FR-2. `startsOn` ≥ 2026-11-01 (422 BEFORE_HISTORY_START) and ≤ today + 366 days (400 on
 * `startsOn`) are checked by the use case; `coversProvider` only for `ai` / `data_providers`
 * (422 COVERS_PROVIDER_CATEGORY).
 */
export const createRecurringExpense = z.object({
  kind: z.literal('recurring'),
  name,
  vendor,
  category,
  amountCents,
  cadence,
  startsOn: isoDate,
  endsOn: isoDate.optional(),
  coversProvider: providerKey.optional(),
  link: link.optional(),
  notes: notes.optional(),
});

/** FR-4. `spentOn` in 2026-11-01..today: before → 422, future → 400 "Date can't be in the future". */
export const createOneOffExpense = z.object({
  kind: z.literal('one_off'),
  name,
  vendor,
  category,
  amountCents,
  spentOn: isoDate,
  link: link.optional(),
  notes: notes.optional(),
});

export const createExpenseBody = z
  .discriminatedUnion('kind', [createRecurringExpense, createOneOffExpense])
  .refine((b) => b.kind !== 'recurring' || !b.endsOn || b.endsOn >= b.startsOn, {
    path: ['endsOn'],
    message: END_BEFORE_START,
  });
export type CreateExpenseBody = z.infer<typeof createExpenseBody>;

/** FR-3: what a Recurring bill's edit may change (the amount changes only through a price). */
export const recurringExpensePatch = z.strictObject({
  name: name.optional(),
  vendor: vendor.optional(),
  category: category.optional(),
  link: link.nullable().optional(),
  notes: notes.nullable().optional(),
  coversProvider: providerKey.nullable().optional(),
  endsOn: isoDate.nullable().optional(),
});
export type RecurringExpensePatch = z.infer<typeof recurringExpensePatch>;

/** FR-4: a One-off's edit may change every field. */
export const oneOffExpensePatch = z.strictObject({
  name: name.optional(),
  vendor: vendor.optional(),
  category: category.optional(),
  amountCents: amountCents.optional(),
  spentOn: isoDate.optional(),
  link: link.nullable().optional(),
  notes: notes.nullable().optional(),
});
export type OneOffExpensePatch = z.infer<typeof oneOffExpensePatch>;

/**
 * PATCH body: any field of either kind, at least one. The use case parses it again with
 * `recurringExpensePatch` or `oneOffExpensePatch` once it knows the kind, so a field that doesn't
 * apply (e.g. `amountCents` on a Recurring bill) is a 400 on that field. `null` clears.
 */
export const updateExpenseBody = z
  .strictObject({ ...recurringExpensePatch.shape, ...oneOffExpensePatch.shape })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
export type UpdateExpenseBody = z.infer<typeof updateExpenseBody>;

/** FR-3. Same date as an existing version replaces its amount. */
export const addPriceBody = z.object({ effectiveFrom: isoDate, amountCents });
export type AddPriceBody = z.infer<typeof addPriceBody>;

/** FR-8. $0.00 is a valid invoice. */
export const saveInvoiceBody = z.object({
  amountCents: z.int().min(0).max(MAX_AMOUNT_CENTS),
  note: z.string().trim().max(200).optional(),
});
export type SaveInvoiceBody = z.infer<typeof saveInvoiceBody>;

/** FR-11. 0 means any spend is over budget. */
export const saveBudgetBody = z.object({
  monthlyBudgetCents: z.int().min(0).max(MAX_AMOUNT_CENTS),
});
export type SaveBudgetBody = z.infer<typeof saveBudgetBody>;

// Shapes -----------------------------------------------------------------------------------------

export const provider = z.object({ key: providerKey, name: z.string() });
export type Provider = z.infer<typeof provider>;

export const priceVersion = z.object({ effectiveFrom: isoDate, amount: money });
export type PriceVersion = z.infer<typeof priceVersion>;

export const charge = z.object({ date: isoDate, amount: money });
export type Charge = z.infer<typeof charge>;

/** A Recurring bill or a One-off expense (FR-1). */
export const expense = z.object({
  id,
  kind: expenseKind,
  name: z.string(),
  vendor: z.string(),
  category,
  /** The price in effect today, or the One-off amount. */
  amount: money,
  /** null for a One-off. */
  cadence: cadence.nullable(),
  /** A One-off's `spentOn`. */
  startsOn: isoDate,
  endsOn: isoDate.nullable(),
  /** Recurring and not ended; null otherwise. */
  nextChargeOn: isoDate.nullable(),
  status: expenseStatus,
  coversProvider: provider.nullable(),
  link: z.string().nullable(),
  notes: z.string().nullable(),
  /** Yearly bills: amount / 12 rounded half up; monthly: the amount; One-off: null. */
  monthlyEquivalent: money.nullable(),
  /** Recurring only (empty for a One-off), ascending by `effectiveFrom`. */
  versions: z.array(priceVersion),
  /** The Charges (or the One-off) in the listed month. */
  chargesInMonth: z.array(charge),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Expense = z.infer<typeof expense>;

export const countedSource = z.enum(['invoice', 'plan', 'estimate']);
export type CountedSource = z.infer<typeof countedSource>;

/** One provider's month on the Provider invoices tab (FR-8). */
export const providerRow = z.object({
  provider,
  category: providerCategory,
  metered: money,
  invoice: z
    .object({
      amount: money,
      note: z.string().nullable(),
      enteredAt: isoDateTime,
      enteredBy: staffRef,
    })
    .nullable(),
  /** The Recurring bill that covers this provider, with its Charges in the month. */
  plan: z.object({ expenseId: id, name: z.string(), amount: money }).nullable(),
  /** The single amount that counts in the P&L. */
  counted: z.object({ source: countedSource, amount: money }),
  /** (invoice − metered) / metered × 100, one decimal; null without an invoice or metered 0. */
  gapPct: z.number().nullable(),
  /** metered / plan × 100 rounded, with a plan and no invoice; null otherwise. */
  planUsedPct: z.int().nonnegative().nullable(),
  flagged: z.boolean(),
});
export type ProviderRow = z.infer<typeof providerRow>;

export const budgetThreshold = z.literal([80, 100]);
export type BudgetThreshold = z.infer<typeof budgetThreshold>;

export const budgetStatus = z.enum(['under', 'near', 'over']);
export type BudgetStatus = z.infer<typeof budgetStatus>;

export const costOfRevenueSource = z.enum(['providers', 'stripe_fees', 'bills']);
export type CostOfRevenueSource = z.infer<typeof costOfRevenueSource>;

/** The P&L for one month (FR-9, FR-11). */
export const pnl = z.object({
  month,
  /** The current month: "Month to date". */
  monthToDate: z.boolean(),
  revenue: z.object({
    sales: money,
    salesCount: z.int().nonnegative(),
    /** Net of tax, as a positive amount (subtracted). */
    refunds: money,
    net: signedMoney,
  }),
  costOfRevenue: z.object({
    lines: z.array(
      z.object({
        category,
        label: z.string(),
        amount: money,
        source: costOfRevenueSource,
      }),
    ),
    total: money,
  }),
  grossProfit: signedMoney,
  /** One decimal; null when revenue is 0. May be negative. */
  grossMarginPct: z.number().nullable(),
  operating: z.object({
    lines: z.array(z.object({ category, amount: money })),
    total: money,
  }),
  netProfit: signedMoney,
  totalExpenses: money,
  /** Non-zero categories, largest first. */
  categories: z.array(z.object({ category, amount: money, sharePct: z.number().min(0).max(100) })),
  yearlyThisMonth: z.array(
    z.object({ expenseId: id, name: z.string(), amount: money, monthlyEquivalent: money }),
  ),
  fixedRunRate: money,
  budget: z.object({
    amount: money,
    spent: money,
    /** spent / budget × 100 rounded; null when the Budget is 0. */
    pct: z.int().nonnegative().nullable(),
    status: budgetStatus,
    alertsSent: z.array(budgetThreshold),
  }),
  /** Provider rows flagged this month (FR-8). */
  providerFlags: z.int().nonnegative(),
  /** The 12 months ending with `month`, oldest first; null before the history start. */
  trend: z
    .array(
      z.object({
        month,
        revenue: signedMoney.nullable(),
        expenses: money.nullable(),
        net: signedMoney.nullable(),
      }),
    )
    .length(12),
});
export type Pnl = z.infer<typeof pnl>;

export const budget = z.object({
  monthlyBudget: money,
  updatedAt: isoDateTime,
  updatedBy: staffRef.nullable(),
});
export type Budget = z.infer<typeof budget>;

// Error bodies with details --------------------------------------------------------------------------

/** 409 PROVIDER_ALREADY_COVERED names the other bill. */
export const providerAlreadyCoveredError = z.object({
  error: z.object({
    code: z.literal('PROVIDER_ALREADY_COVERED'),
    message: z.string(),
    details: z.object({ expenseId: id, name: z.string() }),
  }),
});
export type ProviderAlreadyCoveredError = z.infer<typeof providerAlreadyCoveredError>;

// Endpoints --------------------------------------------------------------------------------------

const monthQuery = z.object({
  /** Defaults to the current month. */
  month: month.optional(),
});

const monthErrors = [err(422, 'BEFORE_HISTORY_START'), err(422, 'FUTURE_MONTH')] as const;

/** FR-1. No pagination (< 200 rows). Default: active bills plus the month's One-offs. */
export const listExpenses = defineContract({
  method: 'GET',
  path: '/api/staff/finance/expenses',
  auth: 'staff',
  status: 200,
  query: monthQuery.extend({
    category: category.optional(),
    kind: expenseKind.optional(),
    includeEnded: z.stringbool().default(false),
  }),
  response: z.object({
    month,
    items: z.array(expense),
    totals: z.object({ fixedRunRate: money, chargesInMonth: money }),
  }),
  errors: [...monthErrors],
});

/** FR-2, FR-4. Audit `expense.created`; analytics `expense_created`. */
export const createExpense = defineContract({
  method: 'POST',
  path: '/api/staff/finance/expenses',
  auth: 'staff',
  status: 201,
  body: createExpenseBody,
  response: expense,
  errors: [
    err(404, 'UNKNOWN_PROVIDER'),
    err(409, 'PROVIDER_ALREADY_COVERED'),
    err(422, 'BEFORE_HISTORY_START'),
    err(422, 'COVERS_PROVIDER_CATEGORY'),
  ],
});

/** FR-3, FR-4. Audit `expense.updated` / `expense.ended`. */
export const updateExpense = defineContract({
  method: 'PATCH',
  path: '/api/staff/finance/expenses/:id',
  auth: 'staff',
  status: 200,
  params: idParams,
  body: updateExpenseBody,
  response: expense,
  errors: [
    err(404, 'NOT_FOUND'),
    err(404, 'UNKNOWN_PROVIDER'),
    err(409, 'PROVIDER_ALREADY_COVERED'),
    err(422, 'BEFORE_HISTORY_START'),
    err(422, 'COVERS_PROVIDER_CATEGORY'),
  ],
});

/** FR-3. Recurring only. Audit `expense.price_changed`; analytics `expense_price_changed`. */
export const addExpensePrice = defineContract({
  method: 'POST',
  path: '/api/staff/finance/expenses/:id/prices',
  auth: 'staff',
  status: 201,
  params: idParams,
  body: addPriceBody,
  response: expense,
  errors: [err(404, 'NOT_FOUND'), err(409, 'NOT_RECURRING'), err(422, 'EFFECTIVE_BEFORE_START')],
});

/** FR-3. Removes a price version other than the first. */
export const deleteExpensePrice = defineContract({
  method: 'DELETE',
  path: '/api/staff/finance/expenses/:id/prices/:effectiveFrom',
  auth: 'staff',
  status: 200,
  params: z.object({ id, effectiveFrom: isoDate }),
  response: expense,
  errors: [err(404, 'NOT_FOUND'), err(409, 'FIRST_VERSION')],
});

/** FR-3. Soft delete; a Recurring bill that has charged is 409 HAS_CHARGES ("End the bill instead"). */
export const deleteExpense = defineContract({
  method: 'DELETE',
  path: '/api/staff/finance/expenses/:id',
  auth: 'staff',
  status: 204,
  params: idParams,
  response: noContent,
  errors: [err(404, 'NOT_FOUND'), err(409, 'HAS_CHARGES')],
});

/** FR-6. The Tool catalog's providers, for the "covers usage of" picker. */
export const listProviders = defineContract({
  method: 'GET',
  path: '/api/staff/finance/providers',
  auth: 'staff',
  status: 200,
  response: z.object({ items: z.array(provider.extend({ category: providerCategory })) }),
});

/** FR-8. Providers with metered cost, a plan or an invoice in the month. */
export const listProviderInvoices = defineContract({
  method: 'GET',
  path: '/api/staff/finance/provider-invoices',
  auth: 'staff',
  status: 200,
  query: monthQuery,
  response: z.object({
    month,
    rows: z.array(providerRow),
    totals: z.object({ metered: money, counted: money }),
    flaggedCount: z.int().nonnegative(),
  }),
  errors: [...monthErrors],
});

const invoiceParams = z.object({ provider: providerKey, month });

/** FR-8. Saving again replaces it. Audit `provider_invoice.saved`; analytics `provider_invoice_entered`. */
export const saveProviderInvoice = defineContract({
  method: 'PUT',
  path: '/api/staff/finance/provider-invoices/:provider/:month',
  auth: 'staff',
  status: 200,
  params: invoiceParams,
  body: saveInvoiceBody,
  response: providerRow,
  errors: [err(404, 'UNKNOWN_PROVIDER'), ...monthErrors],
});

/** FR-8. Reverts to the plan or the estimate. Audit `provider_invoice.deleted`. */
export const deleteProviderInvoice = defineContract({
  method: 'DELETE',
  path: '/api/staff/finance/provider-invoices/:provider/:month',
  auth: 'staff',
  status: 200,
  params: invoiceParams,
  response: providerRow,
  errors: [err(404, 'UNKNOWN_PROVIDER'), err(404, 'NO_INVOICE'), ...monthErrors],
});

/** FR-9, FR-11. Analytics `pnl_viewed`. */
export const getPnl = defineContract({
  method: 'GET',
  path: '/api/staff/finance/pnl',
  auth: 'staff',
  status: 200,
  query: monthQuery,
  response: pnl,
  errors: [...monthErrors],
});

/** At most 24 months per export (FR-10). */
export const MAX_EXPORT_MONTHS = 24;

function monthIndex(m: string): number {
  const [y, mm] = m.split('-').map(Number) as [number, number];
  return y * 12 + (mm - 1);
}

export const pnlCsvQuery = z
  .object({ from: month, to: month })
  .refine((q) => q.from <= q.to, { path: ['from'], message: "From can't be after To" })
  .refine((q) => monthIndex(q.to) - monthIndex(q.from) < MAX_EXPORT_MONTHS, {
    path: ['to'],
    message: `Export at most ${MAX_EXPORT_MONTHS} months`,
  });
export type PnlCsvQuery = z.infer<typeof pnlCsvQuery>;

/**
 * FR-10. UTF-8 with BOM, `Content-Disposition: attachment;
 * filename="llyner-leads-pnl-<from>-to-<to>.csv"`. Analytics `pnl_exported`; Audit `pnl.exported`.
 */
export const exportPnlCsv = defineContract({
  method: 'GET',
  path: '/api/staff/finance/pnl.csv',
  auth: 'staff',
  status: 200,
  query: pnlCsvQuery,
  contentType: 'text/csv',
  response: z.string(),
  errors: [...monthErrors],
});

/** FR-11. `updatedBy` null while the default has never been changed. */
export const getBudget = defineContract({
  method: 'GET',
  path: '/api/staff/finance/budget',
  auth: 'staff',
  status: 200,
  response: budget,
});

/** FR-11. Audit `budget.changed`. */
export const saveBudget = defineContract({
  method: 'PUT',
  path: '/api/staff/finance/budget',
  auth: 'staff',
  status: 200,
  body: saveBudgetBody,
  response: budget,
});

/** FR-12, AJ-4. Registered only when NODE_ENV=test; runs the budget check now. */
export const runBudgetCheck = defineContract({
  method: 'POST',
  path: '/api/test/jobs/budget-check',
  auth: 'public',
  status: 200,
  response: z.object({ sent: z.array(budgetThreshold) }),
});

export const financeContracts = {
  listExpenses,
  createExpense,
  updateExpense,
  addExpensePrice,
  deleteExpensePrice,
  deleteExpense,
  listProviders,
  listProviderInvoices,
  saveProviderInvoice,
  deleteProviderInvoice,
  getPnl,
  exportPnlCsv,
  getBudget,
  saveBudget,
} as const;

/** Test-only endpoints, kept out of `financeContracts` (never in production). */
export const financeTestContracts = { runBudgetCheck } as const;
