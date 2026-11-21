import type { Budget, Pnl, SaveBudgetBody } from '@app/contracts/finance';
import type { Actor } from '../../../shared/domain/actor.js';
import { budgetProgress, type BudgetStatus, type BudgetThreshold } from '../domain/budget.js';
import { monthRange, type MonthKey } from '../domain/calendar.js';
import { CATEGORY_LABELS } from '../domain/categories.js';
import {
  biggestItems,
  computeMonth,
  EMPTY_MONTH,
  type LineItem,
  type MonthStatement,
  type SpendItem,
} from '../domain/pnl.js';
import type { FinanceContext } from './ports.js';
import { currentMonthOf, requireStaff, resolveMonth, todayOf } from './rules.js';
import { Statements } from './statements.js';
import { budgetView, pnlView } from './views.js';

type Ctx = Pick<FinanceContext, 'store' | 'billing' | 'tools' | 'members' | 'analytics' | 'clock'>;

/** FR-9, FR-11: the month's P&L with the Budget and the 12-month trend. */
export class GetPnl {
  constructor(private readonly ctx: Ctx) {}

  async execute(caller: Actor | null, query: { month?: MonthKey }): Promise<Pnl> {
    const actor = requireStaff(caller);
    const month = resolveMonth(query.month, this.ctx.clock);
    const statement = await new Statements(this.ctx).pnl(month);
    await this.ctx.analytics.track({
      name: 'pnl_viewed',
      actor: { memberId: actor.memberId, businessId: actor.businessId },
      properties: { month, is_current_month: statement.monthToDate },
    });
    return pnlView(statement);
  }
}

// FR-10: CSV ------------------------------------------------------------------------------------------

const CSV_HEADER = ['month', 'section', 'category', 'item', 'source', 'amount_usd'];
const BOM = '﻿';

/** Two decimals from integer cents, negatives with a leading minus. */
export function usd(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Quotes a field when needed; text that a spreadsheet would run as a formula gets a leading '. */
function field(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const SECTION_TOTALS = [
  ['revenue', (s: MonthStatement) => s.revenueCents],
  ['cost_of_revenue', (s: MonthStatement) => s.costOfRevenueCents],
  ['operating', (s: MonthStatement) => s.operatingCents],
] as const;

/** One row per line item, then a total row per section and a `net` row, for each month. */
export function pnlCsv(statements: readonly MonthStatement[]): string {
  const rows: string[][] = [CSV_HEADER];
  const row = (
    month: string,
    i: Pick<LineItem, 'section' | 'item'> & {
      category: string;
      source: string;
      amountCents: number;
    },
  ) => rows.push([month, i.section, i.category, field(i.item), i.source, usd(i.amountCents)]);
  for (const s of statements) {
    for (const [section, total] of SECTION_TOTALS) {
      for (const i of s.items.filter((x) => x.section === section)) {
        row(s.month, { ...i, category: i.category ?? '' });
      }
      row(s.month, { section, category: '', item: 'Total', source: '', amountCents: total(s) });
    }
    rows.push([s.month, 'net', '', 'Net profit', '', usd(s.netProfitCents)]);
  }
  return BOM + rows.map((r) => r.join(',')).join('\r\n') + '\r\n';
}

export class ExportPnlCsv {
  constructor(private readonly ctx: Ctx) {}

  async execute(
    caller: Actor | null,
    query: { from: MonthKey; to: MonthKey },
  ): Promise<{ fileName: string; csv: string }> {
    const actor = requireStaff(caller);
    resolveMonth(query.from, this.ctx.clock);
    resolveMonth(query.to, this.ctx.clock);
    const statements = new Statements(this.ctx);
    const months = monthRange(query.from, query.to);
    const [expenses, data] = await Promise.all([
      statements.expenses(),
      statements.monthData(months),
    ]);
    const today = todayOf(this.ctx.clock);
    const monthStatements = months.map((month) =>
      computeMonth({ month, today, expenses, data: data.get(month) ?? EMPTY_MONTH }),
    );
    await this.ctx.store.run((repos) =>
      repos.audit.record({
        staffMemberId: actor.memberId,
        businessId: null,
        action: 'pnl.exported',
        targetType: 'pnl',
        targetId: `${query.from}..${query.to}`,
        details: { from: query.from, to: query.to },
      }),
    );
    await this.ctx.analytics.track({
      name: 'pnl_exported',
      actor: { memberId: actor.memberId, businessId: actor.businessId },
      properties: { from_month: query.from, to_month: query.to },
    });
    return {
      fileName: `llyner-leads-pnl-${query.from}-to-${query.to}.csv`,
      csv: pnlCsv(monthStatements),
    };
  }
}

// FR-11: Budget ---------------------------------------------------------------------------------------

export class GetBudget {
  constructor(private readonly ctx: Ctx) {}

  async execute(caller: Actor | null): Promise<Budget> {
    requireStaff(caller);
    return budgetView(await this.ctx.store.read.budgets.settings(), this.ctx.members);
  }
}

/** Changes the Budget for the current and future months; past months keep their snapshot. */
export class SaveBudget {
  constructor(private readonly ctx: Ctx) {}

  async execute(caller: Actor | null, body: SaveBudgetBody): Promise<Budget> {
    const actor = requireStaff(caller);
    const now = this.ctx.clock.now();
    const month = currentMonthOf(this.ctx.clock);
    const settings = await this.ctx.store.run(async (repos) => {
      const before = await repos.budgets.settings();
      const next = {
        monthlyBudgetCents: body.monthlyBudgetCents,
        updatedByMemberId: actor.memberId,
        updatedAt: now,
      };
      await repos.budgets.saveSettings(next);
      await repos.budgets.saveSnapshot(month, body.monthlyBudgetCents, now, true);
      await repos.audit.record({
        staffMemberId: actor.memberId,
        businessId: null,
        action: 'budget.changed',
        targetType: 'budget',
        targetId: null,
        details: {
          monthlyBudgetCents: { from: before.monthlyBudgetCents, to: body.monthlyBudgetCents },
          month,
        },
      });
      return next;
    });
    return budgetView(settings, this.ctx.members);
  }
}

/** The current month's spend against its Budget (FR-11), for the budget alert job (FR-12). */
export interface MonthSpend {
  month: MonthKey;
  spentCents: number;
  budgetCents: number;
  pct: number | null;
  status: BudgetStatus;
  alertsSent: BudgetThreshold[];
  /** The 3 biggest items so far: named bills, automatic lines by category. */
  topItems: (SpendItem & { categoryLabel: string })[];
}

export class BudgetService {
  constructor(private readonly ctx: Ctx) {}

  /** Month to date, the same numbers the P&L shows; writes the month's Budget snapshot. */
  async currentMonthSpend(): Promise<MonthSpend> {
    const month = currentMonthOf(this.ctx.clock);
    const statements = new Statements(this.ctx);
    const [statement, budgetCents, alertsSent] = await Promise.all([
      statements.month(month),
      statements.budgetFor(month),
      this.ctx.store.read.budgets.alertsSent(month),
    ]);
    const progress = budgetProgress(statement.totalExpensesCents, budgetCents);
    return {
      month,
      spentCents: progress.spentCents,
      budgetCents,
      pct: progress.pct,
      status: progress.status,
      alertsSent,
      topItems: biggestItems(statement).map((i) => ({
        ...i,
        categoryLabel: CATEGORY_LABELS[i.category],
      })),
    };
  }
}
