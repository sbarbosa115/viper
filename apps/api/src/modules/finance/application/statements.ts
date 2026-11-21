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
 * Loads what the pure P&L functions need: bills, each month's sales, refunds and metered costs
 * (one aggregate call per month to billing and tools) and the months' invoices (one query).
 */
export class Statements {
  constructor(private readonly ctx: Ctx) {}

  async monthData(months: readonly MonthKey[]): Promise<Map<MonthKey, MonthData>> {
    const [invoices, perMonth] = await Promise.all([
      months.length > 0 ? this.ctx.store.read.invoices.forMonths(months) : Promise.resolve([]),
      Promise.all(
        months.map(async (m) => {
          const [revenue, metered] = await Promise.all([
            this.ctx.billing.revenueForMonth(m),
            this.ctx.tools.meteredCostByProvider(m),
          ]);
          return [m, { ...revenue, metered }] as const;
        }),
      ),
    ]);
    return new Map(
      perMonth.map(([m, d]) => [
        m,
        { ...EMPTY_MONTH, ...d, invoices: invoices.filter((i) => i.month === m) },
      ]),
    );
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
