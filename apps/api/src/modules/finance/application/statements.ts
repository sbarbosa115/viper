import type { MonthKey } from '../domain/calendar.js';
import type { Expense } from '../domain/expense.js';
import {
  buildPnl,
  computeMonth,
  EMPTY_MONTH,
  trendMonths,
  type MonthData,
  type MonthStatement,
  type PnlStatement,
} from '../domain/pnl.js';
import type { FinanceContext } from './ports.js';
import { todayOf } from './rules.js';

type Ctx = Pick<FinanceContext, 'store' | 'billing' | 'tools' | 'clock'>;

/**
 * Loads what the pure P&L functions need: bills, and for a run of months their sales, refunds and
 * metered costs (one range call each to billing and tools, NFR-1) and invoices (one query).
 */
export class Statements {
  constructor(private readonly ctx: Ctx) {}

  /** `months` is a contiguous ascending run (one month, the trend, or a CSV range). */
  async monthData(months: readonly MonthKey[]): Promise<Map<MonthKey, MonthData>> {
    const first = months[0];
    const last = months.at(-1);
    if (first === undefined || last === undefined) return new Map();
    const [invoices, revenue, metered] = await Promise.all([
      this.ctx.store.read.invoices.forMonths(months),
      this.ctx.billing.revenueForMonths(first, last),
      this.ctx.tools.meteredCostByProviderMonths(first, last),
    ]);
    const data = new Map<MonthKey, MonthData>(months.map((m) => [m, { ...EMPTY_MONTH }]));
    const update = (m: MonthKey, patch: (d: MonthData) => Partial<MonthData>) => {
      const d = data.get(m);
      if (d) data.set(m, { ...d, ...patch(d) });
    };
    for (const r of revenue) update(r.month, () => ({ sales: r.sales, refunds: r.refunds }));
    for (const c of metered) {
      update(c.month, (d) => ({
        metered: [...d.metered, { provider: c.provider, micros: c.micros }],
      }));
    }
    for (const i of invoices) update(i.month, (d) => ({ invoices: [...d.invoices, i] }));
    return data;
  }

  expenses(): Promise<Expense[]> {
    return this.ctx.store.read.expenses.listAll();
  }

  /** The Budget in effect for a month: its snapshot, written from the setting on first read (FR-11). */
  async budgetFor(month: MonthKey): Promise<number> {
    const budgets = this.ctx.store.read.budgets;
    const snapshot = await budgets.snapshot(month);
    if (snapshot !== null) return snapshot;
    const { monthlyBudgetCents } = await budgets.settings();
    await budgets.saveSnapshot(month, monthlyBudgetCents, this.ctx.clock.now(), false);
    return (await budgets.snapshot(month)) ?? monthlyBudgetCents;
  }

  /** One month's statement (no trend or Budget). */
  async month(month: MonthKey): Promise<MonthStatement> {
    const [expenses, data] = await Promise.all([this.expenses(), this.monthData([month])]);
    return computeMonth({
      month,
      today: todayOf(this.ctx.clock),
      expenses,
      data: data.get(month) ?? EMPTY_MONTH,
    });
  }

  /** The full P&L for a month (FR-9, FR-11). */
  async pnl(month: MonthKey): Promise<PnlStatement> {
    const [expenses, data, budgetCents, alertsSent] = await Promise.all([
      this.expenses(),
      this.monthData(trendMonths(month)),
      this.budgetFor(month),
      this.ctx.store.read.budgets.alertsSent(month),
    ]);
    return buildPnl({
      month,
      today: todayOf(this.ctx.clock),
      expenses,
      data,
      budget: { cents: budgetCents, alertsSent },
    });
  }
}
