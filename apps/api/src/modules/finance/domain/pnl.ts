import { budgetProgress, type BudgetProgress, type BudgetThreshold } from './budget.js';
import {
  addMonths,
  HISTORY_START_MONTH,
  pctOneDecimal,
  roundHalfUp,
  sum,
  type CalendarDay,
  type MonthKey,
} from './calendar.js';
import {
  CATEGORY_LABELS,
  categoryRank,
  isCostOfRevenue,
  providerCategoryOf,
  type Category,
  type ProviderCategory,
} from './categories.js';
import type { Expense } from './expense.js';

/**
 * The P&L arithmetic (prd-expenses FR-5, FR-6, FR-8, FR-9, FR-11), pure and in integer cents.
 * Rounding is half up at each conversion (micros → cents per provider-month, fee per sale, refund
 * net of tax per refund, monthly equivalent per bill), then sums.
 */

// Inputs -------------------------------------------------------------------------------------------

/** A paid Purchase with `paid_at` in the month. */
export interface Sale {
  readonly purchaseId: string;
  /** Excludes tax. */
  readonly amountCents: number;
  readonly taxCents: number;
  readonly paidAt: Date;
}

/** One refund event of a Purchase, in the month it happened. */
export interface Refund {
  readonly purchaseId: string;
  /** This event's refunded amount, gross (tax included). */
  readonly refundedCents: number;
  readonly amountCents: number;
  readonly taxCents: number;
  readonly refundedAt: Date;
}

export interface MeteredCost {
  /** The Tool catalog provider name. */
  readonly provider: string;
  readonly micros: number;
}

export interface InvoiceFact {
  /** The Tool catalog provider name. */
  readonly provider: string;
  readonly month: MonthKey;
  readonly amountCents: number;
  readonly note: string | null;
  readonly enteredAt: Date;
  readonly enteredByMemberId: string;
}

/** What the other contexts and the invoices say about one month. */
export interface MonthData {
  readonly sales: readonly Sale[];
  readonly refunds: readonly Refund[];
  readonly metered: readonly MeteredCost[];
  readonly invoices: readonly InvoiceFact[];
}

export const EMPTY_MONTH: MonthData = { sales: [], refunds: [], metered: [], invoices: [] };

// Rules --------------------------------------------------------------------------------------------

export const STRIPE_FEES_LABEL = 'Stripe fees (estimated, 2.9% + 30¢ per sale)';
/** |gap| above this is flagged (FR-8). */
const GAP_FLAG_PCT = 15;

/** FR-5: round_half_up(total × 0.029) + 30 cents, total = amount + tax. */
export function stripeFeeCents(sale: Pick<Sale, 'amountCents' | 'taxCents'>): number {
  return roundHalfUp((sale.amountCents + sale.taxCents) * 29, 1000) + 30;
}

/** FR-7: refunded × amount / (amount + tax), rounded half up. */
export function refundNetCents(
  refund: Pick<Refund, 'refundedCents' | 'amountCents' | 'taxCents'>,
): number {
  const total = refund.amountCents + refund.taxCents;
  if (total <= 0) return 0;
  return roundHalfUp(refund.refundedCents * refund.amountCents, total);
}

/** FR-6: micros → cents, rounded half up. */
export function microsToCents(micros: number): number {
  return roundHalfUp(micros, 10_000);
}

// Provider rows (FR-8) -------------------------------------------------------------------------------

export type CountedSource = 'invoice' | 'plan' | 'estimate';

export interface ProviderLine {
  readonly provider: string;
  readonly category: ProviderCategory;
  readonly meteredCents: number;
  readonly invoice: InvoiceFact | null;
  /** The Recurring bill(s) covering the provider this month; the latest one names it. */
  readonly plan: {
    readonly expenseId: string;
    readonly name: string;
    readonly amountCents: number;
    readonly category: Category;
  } | null;
  /** The single amount that counts in the P&L, and where it goes. */
  readonly counted: {
    readonly source: CountedSource;
    readonly amountCents: number;
    readonly category: Category;
  };
  readonly gapPct: number | null;
  readonly planUsedPct: number | null;
  readonly flagged: boolean;
}

interface MonthScope {
  readonly month: MonthKey;
  readonly today: CalendarDay;
  readonly expenses: readonly Expense[];
}

function planFor(provider: string, scope: MonthScope): ProviderLine['plan'] {
  const bills = scope.expenses
    .filter((e) => e.coversProvider === provider && e.isPlanIn(scope.month, scope.today))
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const latest = bills.at(-1);
  if (!latest) return null;
  const amountCents = sum(
    bills.flatMap((b) => b.chargesIn(scope.month, scope.today).map((c) => c.amountCents)),
  );
  return { expenseId: latest.id, name: latest.name, amountCents, category: latest.category };
}

/**
 * FR-8: one row per provider with metered cost, a linked plan or an invoice in the month, sorted
 * by name. Single-source rule: invoice, else the linked plan's Charges, else the metered estimate.
 */
export function providerLines(
  scope: MonthScope & { metered: readonly MeteredCost[]; invoices: readonly InvoiceFact[] },
): ProviderLine[] {
  const meteredBy = new Map<string, number>();
  for (const m of scope.metered)
    meteredBy.set(m.provider, (meteredBy.get(m.provider) ?? 0) + m.micros);
  const invoiceBy = new Map(
    scope.invoices.filter((i) => i.month === scope.month).map((i) => [i.provider, i]),
  );
  const covered = scope.expenses.flatMap((e) => (e.coversProvider ? [e.coversProvider] : []));
  const names = new Set([...meteredBy.keys(), ...invoiceBy.keys(), ...covered]);

  const rows: ProviderLine[] = [];
  for (const provider of names) {
    const meteredCents = microsToCents(meteredBy.get(provider) ?? 0);
    const invoice = invoiceBy.get(provider) ?? null;
    const plan = planFor(provider, scope);
    if (meteredCents === 0 && !invoice && !plan) continue;
    const category = providerCategoryOf(provider);
    const counted = invoice
      ? { source: 'invoice' as const, amountCents: invoice.amountCents, category }
      : plan
        ? { source: 'plan' as const, amountCents: plan.amountCents, category: plan.category }
        : { source: 'estimate' as const, amountCents: meteredCents, category };
    const gapPct =
      invoice && meteredCents > 0
        ? pctOneDecimal(invoice.amountCents - meteredCents, meteredCents)
        : null;
    const flagged = invoice
      ? meteredCents > 0
        ? Math.abs(invoice.amountCents - meteredCents) * 100 > GAP_FLAG_PCT * meteredCents
        : invoice.amountCents > 0
      : false;
    const planUsedPct =
      plan && !invoice && plan.amountCents > 0
        ? roundHalfUp(meteredCents * 100, plan.amountCents)
        : null;
    rows.push({
      provider,
      category,
      meteredCents,
      invoice,
      plan,
      counted,
      gapPct,
      planUsedPct,
      flagged,
    });
  }
  return rows.sort((a, b) => a.provider.localeCompare(b.provider));
}

// One month (FR-9) ----------------------------------------------------------------------------------

export type Section = 'revenue' | 'cost_of_revenue' | 'operating';
export type LineSource =
  'sale' | 'refund' | 'stripe_fee' | 'invoice' | 'plan' | 'estimate' | 'bill' | 'one_off';

/** One CSV row (FR-10). Amounts are signed: refunds are negative. */
export interface LineItem {
  readonly section: Section;
  readonly category: Category | null;
  readonly item: string;
  readonly source: LineSource;
  readonly amountCents: number;
}

export type CostLineSource = 'providers' | 'stripe_fees' | 'bills';

export interface MonthStatement {
  readonly month: MonthKey;
  readonly salesCents: number;
  readonly salesCount: number;
  /** Positive; subtracted from sales. */
  readonly refundsCents: number;
  readonly revenueCents: number;
  readonly providers: readonly ProviderLine[];
  readonly flaggedCount: number;
  readonly costLines: readonly {
    readonly category: Category;
    readonly label: string;
    readonly amountCents: number;
    readonly source: CostLineSource;
  }[];
  readonly costOfRevenueCents: number;
  readonly grossProfitCents: number;
  readonly grossMarginPct: number | null;
  readonly operatingLines: readonly { readonly category: Category; readonly amountCents: number }[];
  readonly operatingCents: number;
  readonly netProfitCents: number;
  readonly totalExpensesCents: number;
  readonly categories: readonly {
    readonly category: Category;
    readonly amountCents: number;
    readonly sharePct: number;
  }[];
  readonly yearlyThisMonth: readonly {
    readonly expenseId: string;
    readonly name: string;
    readonly amountCents: number;
    readonly monthlyEquivalentCents: number;
  }[];
  readonly items: readonly LineItem[];
}

const sumOf = <T>(items: readonly T[], amount: (t: T) => number) => sum(items.map(amount));

/** Everything a month's statement shows, from bills, Purchases, metered costs and invoices. */
export function computeMonth(scope: MonthScope & { data: MonthData }): MonthStatement {
  const { month, today, data } = scope;
  const expenses = scope.expenses.filter((e) => !e.isDeleted);

  // Revenue (FR-9, FR-7)
  const salesCents = sumOf(data.sales, (s) => s.amountCents);
  const refundNets = data.refunds.map((r) => ({ r, net: refundNetCents(r) }));
  const refundsCents = sumOf(refundNets, (x) => x.net);
  const revenueCents = salesCents - refundsCents;
  const items: LineItem[] = [
    ...data.sales.map((s) => ({
      section: 'revenue' as const,
      category: null,
      item: `Sale ${s.purchaseId}`,
      source: 'sale' as const,
      amountCents: s.amountCents,
    })),
    ...refundNets.map(({ r, net }) => ({
      section: 'revenue' as const,
      category: null,
      item: `Refund ${r.purchaseId}`,
      source: 'refund' as const,
      amountCents: -net,
    })),
  ];

  // Providers (FR-6, FR-8) and Stripe fees (FR-5)
  const providers = providerLines({
    month,
    today,
    expenses,
    metered: data.metered,
    invoices: data.invoices,
  });
  for (const p of providers) {
    items.push({
      section: 'cost_of_revenue',
      category: p.counted.category,
      item: p.plan && p.counted.source === 'plan' ? `${p.provider} (${p.plan.name})` : p.provider,
      source: p.counted.source,
      amountCents: p.counted.amountCents,
    });
  }
  const feesCents = sumOf(data.sales, stripeFeeCents);
  if (data.sales.length > 0) {
    items.push({
      section: 'cost_of_revenue',
      category: 'payments_fees',
      item: STRIPE_FEES_LABEL,
      source: 'stripe_fee',
      amountCents: feesCents,
    });
  }

  // Bills and One-offs; a bill covering a provider counts only through its provider row.
  const yearlyThisMonth: MonthStatement['yearlyThisMonth'][number][] = [];
  for (const e of expenses) {
    if (e.coversProvider) continue;
    for (const charge of e.chargesIn(month, today)) {
      items.push({
        section: isCostOfRevenue(e.category) ? 'cost_of_revenue' : 'operating',
        category: e.category,
        item: e.name,
        source: e.kind === 'one_off' ? 'one_off' : 'bill',
        amountCents: charge.amountCents,
      });
    }
  }
  for (const e of expenses) {
    if (e.cadence !== 'yearly') continue;
    for (const charge of e.chargesIn(month, today)) {
      yearlyThisMonth.push({
        expenseId: e.id,
        name: e.name,
        amountCents: charge.amountCents,
        monthlyEquivalentCents: roundHalfUp(charge.amountCents, 12),
      });
    }
  }

  // Cost of revenue lines: provider usage per category, Stripe fees, other bills per category.
  const providerCents = (c: Category) =>
    sumOf(
      providers.filter((p) => p.counted.category === c),
      (p) => p.counted.amountCents,
    );
  const billCents = (c: Category) =>
    sumOf(
      items.filter((i) => i.category === c && (i.source === 'bill' || i.source === 'one_off')),
      (i) => i.amountCents,
    );
  const costLines: MonthStatement['costLines'][number][] = [];
  for (const c of ['data_providers', 'ai', 'payments_fees'] as const) {
    if (c === 'payments_fees') {
      costLines.push({
        category: c,
        label: STRIPE_FEES_LABEL,
        amountCents: feesCents,
        source: 'stripe_fees',
      });
    } else {
      costLines.push({
        category: c,
        label: CATEGORY_LABELS[c],
        amountCents: providerCents(c),
        source: 'providers',
      });
    }
    const bills = billCents(c);
    if (bills > 0) {
      costLines.push({
        category: c,
        label: `${CATEGORY_LABELS[c]} bills`,
        amountCents: bills,
        source: 'bills',
      });
    }
  }
  const costOfRevenueCents = sumOf(costLines, (l) => l.amountCents);

  // Operating expenses by category
  const operatingBy = new Map<Category, number>();
  for (const i of items) {
    if (i.section === 'operating' && i.category) {
      operatingBy.set(i.category, (operatingBy.get(i.category) ?? 0) + i.amountCents);
    }
  }
  const operatingLines = [...operatingBy]
    .filter(([, cents]) => cents > 0)
    .sort(([a], [b]) => categoryRank(a) - categoryRank(b))
    .map(([category, amountCents]) => ({ category, amountCents }));
  const operatingCents = sumOf(operatingLines, (l) => l.amountCents);

  const grossProfitCents = revenueCents - costOfRevenueCents;
  const totalExpensesCents = costOfRevenueCents + operatingCents;

  // Category breakdown: non-zero, largest first, share of total expenses.
  const byCategory = new Map<Category, number>();
  for (const i of items) {
    if (i.section !== 'revenue' && i.category) {
      byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + i.amountCents);
    }
  }
  const categories = [...byCategory]
    .filter(([, cents]) => cents > 0)
    .sort(([ca, a], [cb, b]) => b - a || categoryRank(ca) - categoryRank(cb))
    .map(([category, amountCents]) => ({
      category,
      amountCents,
      sharePct: pctOneDecimal(amountCents, totalExpensesCents),
    }));

  return {
    month,
    salesCents,
    salesCount: data.sales.length,
    refundsCents,
    revenueCents,
    providers,
    flaggedCount: providers.filter((p) => p.flagged).length,
    costLines,
    costOfRevenueCents,
    grossProfitCents,
    grossMarginPct: revenueCents === 0 ? null : pctOneDecimal(grossProfitCents, revenueCents),
    operatingLines,
    operatingCents,
    netProfitCents: grossProfitCents - operatingCents,
    totalExpensesCents,
    categories,
    yearlyThisMonth,
    items,
  };
}

/**
 * FR-9: the sum over Recurring bills not ended today of their current price, yearly ones / 12
 * (each rounded half up, then summed). Bills covering a provider are fixed costs too.
 */
export function fixedRunRateCents(expenses: readonly Expense[], today: CalendarDay): number {
  return sum(
    expenses
      .filter((e) => !e.isDeleted && e.kind === 'recurring' && e.status(today) !== 'ended')
      .map((e) => e.monthlyEquivalent(e.currentAmount(today)) ?? 0),
  );
}

// The P&L (FR-9, FR-11) -----------------------------------------------------------------------------

export interface TrendPoint {
  readonly month: MonthKey;
  readonly revenueCents: number | null;
  readonly expensesCents: number | null;
  readonly netCents: number | null;
}

export interface PnlInputs {
  readonly month: MonthKey;
  readonly today: CalendarDay;
  readonly expenses: readonly Expense[];
  /** The month and each trend month from the history start (missing months count as empty). */
  readonly data: ReadonlyMap<MonthKey, MonthData>;
  readonly budget: { readonly cents: number; readonly alertsSent: readonly BudgetThreshold[] };
}

export interface PnlStatement extends MonthStatement {
  readonly monthToDate: boolean;
  readonly fixedRunRateCents: number;
  readonly budget: BudgetProgress & { readonly alertsSent: readonly BudgetThreshold[] };
  /** The 12 months ending with `month`, oldest first; null before the history start. */
  readonly trend: readonly TrendPoint[];
}

/** The months a P&L for `month` needs data for: the 12-month trend from the history start. */
export function trendMonths(month: MonthKey): MonthKey[] {
  return Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11)).filter(
    (m) => m >= HISTORY_START_MONTH,
  );
}

export function buildPnl(inputs: PnlInputs): PnlStatement {
  const { month, today, expenses } = inputs;
  const statementOf = (m: MonthKey) =>
    computeMonth({ month: m, today, expenses, data: inputs.data.get(m) ?? EMPTY_MONTH });
  const statement = statementOf(month);
  const trend = Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11)).map(
    (m): TrendPoint => {
      if (m < HISTORY_START_MONTH)
        return { month: m, revenueCents: null, expensesCents: null, netCents: null };
      const s = m === month ? statement : statementOf(m);
      return {
        month: m,
        revenueCents: s.revenueCents,
        expensesCents: s.totalExpensesCents,
        netCents: s.netProfitCents,
      };
    },
  );
  return {
    ...statement,
    monthToDate: month === today.slice(0, 7),
    fixedRunRateCents: fixedRunRateCents(expenses, today),
    budget: {
      ...budgetProgress(statement.totalExpensesCents, inputs.budget.cents),
      alertsSent: inputs.budget.alertsSent,
    },
    trend,
  };
}

// Budget items (FR-12 reuses this) ------------------------------------------------------------------

export interface SpendItem {
  /** A bill's or One-off's name; null for automatic lines (usage, Stripe fees), shown by category. */
  readonly name: string | null;
  readonly category: Category;
  readonly amountCents: number;
}

/** The biggest spend items so far: named bills, and automatic lines grouped by category. */
export function biggestItems(statement: MonthStatement, limit = 3): SpendItem[] {
  const byKey = new Map<string, SpendItem>();
  for (const i of statement.items) {
    if (i.section === 'revenue' || !i.category) continue;
    const automatic =
      i.source === 'invoice' || i.source === 'estimate' || i.source === 'stripe_fee';
    const name = automatic ? null : i.item;
    const key = `${name ?? ''}|${i.category}`;
    const prev = byKey.get(key);
    byKey.set(key, {
      name,
      category: i.category,
      amountCents: (prev?.amountCents ?? 0) + i.amountCents,
    });
  }
  return [...byKey.values()]
    .filter((i) => i.amountCents > 0)
    .sort(
      (a, b) =>
        b.amountCents - a.amountCents || categoryRank(a.category) - categoryRank(b.category),
    )
    .slice(0, limit);
}
