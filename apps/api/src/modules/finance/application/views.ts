import {
  providerKeyOf,
  type Budget,
  type Expense as ExpenseDto,
  type Pnl,
  type ProviderRow,
} from '@app/contracts/finance';
import type { CalendarDay, MonthKey } from '../domain/calendar.js';
import type { Expense } from '../domain/expense.js';
import type { PnlStatement, ProviderLine } from '../domain/pnl.js';
import type { BudgetSettings, MemberDirectory } from './ports.js';

/** Domain results → the contract DTOs (prd-expenses section 7 shapes). */

export const money = (cents: number) => ({ cents, currency: 'usd' as const });

/** Shown when a Member id is no longer known to identity (never expected for Staff). */
const UNKNOWN_EMAIL = 'unknown@members.invalid';

export function expenseView(e: Expense, month: MonthKey, today: CalendarDay): ExpenseDto {
  const s = e.toSnapshot();
  const amount = e.currentAmount(today);
  const monthly = e.monthlyEquivalent(amount);
  return {
    id: s.id,
    kind: s.kind,
    name: s.name,
    vendor: s.vendor,
    category: s.category,
    amount: money(amount),
    cadence: s.cadence,
    startsOn: s.startsOn,
    endsOn: s.endsOn,
    nextChargeOn: e.nextChargeOn(today),
    status: e.status(today),
    coversProvider: s.coversProvider
      ? { key: providerKeyOf(s.coversProvider), name: s.coversProvider }
      : null,
    link: s.link,
    notes: s.notes,
    monthlyEquivalent: monthly === null ? null : money(monthly),
    versions:
      s.kind === 'recurring'
        ? s.versions.map((v) => ({ effectiveFrom: v.effectiveFrom, amount: money(v.amountCents) }))
        : [],
    chargesInMonth: e
      .chargesIn(month, today)
      .map((c) => ({ date: c.date, amount: money(c.amountCents) })),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function memberEmails(
  members: MemberDirectory,
  ids: readonly (string | null)[],
): Promise<(id: string) => { id: string; email: string }> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  const emails = unique.length > 0 ? await members.memberEmails(unique) : new Map<string, string>();
  return (id) => ({ id, email: emails.get(id) ?? UNKNOWN_EMAIL });
}

export function providerRowView(
  line: ProviderLine,
  staff: (id: string) => { id: string; email: string },
): ProviderRow {
  return {
    provider: { key: providerKeyOf(line.provider), name: line.provider },
    category: line.category,
    metered: money(line.meteredCents),
    invoice: line.invoice
      ? {
          amount: money(line.invoice.amountCents),
          note: line.invoice.note,
          enteredAt: line.invoice.enteredAt.toISOString(),
          enteredBy: staff(line.invoice.enteredByMemberId),
        }
      : null,
    plan: line.plan
      ? {
          expenseId: line.plan.expenseId,
          name: line.plan.name,
          amount: money(line.plan.amountCents),
        }
      : null,
    counted: { source: line.counted.source, amount: money(line.counted.amountCents) },
    gapPct: line.gapPct,
    planUsedPct: line.planUsedPct,
    flagged: line.flagged,
  };
}

const nullableMoney = (cents: number | null) => (cents === null ? null : money(cents));

export function pnlView(p: PnlStatement): Pnl {
  return {
    month: p.month,
    monthToDate: p.monthToDate,
    revenue: {
      sales: money(p.salesCents),
      salesCount: p.salesCount,
      refunds: money(p.refundsCents),
      net: money(p.revenueCents),
    },
    costOfRevenue: {
      lines: p.costLines.map((l) => ({
        category: l.category,
        label: l.label,
        amount: money(l.amountCents),
        source: l.source,
      })),
      total: money(p.costOfRevenueCents),
    },
    grossProfit: money(p.grossProfitCents),
    grossMarginPct: p.grossMarginPct,
    operating: {
      lines: p.operatingLines.map((l) => ({ category: l.category, amount: money(l.amountCents) })),
      total: money(p.operatingCents),
    },
    netProfit: money(p.netProfitCents),
    totalExpenses: money(p.totalExpensesCents),
    categories: p.categories.map((c) => ({
      category: c.category,
      amount: money(c.amountCents),
      sharePct: c.sharePct,
    })),
    yearlyThisMonth: p.yearlyThisMonth.map((y) => ({
      expenseId: y.expenseId,
      name: y.name,
      amount: money(y.amountCents),
      monthlyEquivalent: money(y.monthlyEquivalentCents),
    })),
    fixedRunRate: money(p.fixedRunRateCents),
    budget: {
      amount: money(p.budget.budgetCents),
      spent: money(p.budget.spentCents),
      pct: p.budget.pct,
      status: p.budget.status,
      alertsSent: [...p.budget.alertsSent],
    },
    providerFlags: p.flaggedCount,
    trend: p.trend.map((t) => ({
      month: t.month,
      revenue: nullableMoney(t.revenueCents),
      expenses: nullableMoney(t.expensesCents),
      net: nullableMoney(t.netCents),
    })),
  };
}

export async function budgetView(
  settings: BudgetSettings,
  members: MemberDirectory,
): Promise<Budget> {
  const staff = await memberEmails(members, [settings.updatedByMemberId]);
  return {
    monthlyBudget: money(settings.monthlyBudgetCents),
    updatedAt: settings.updatedAt.toISOString(),
    updatedBy: settings.updatedByMemberId ? staff(settings.updatedByMemberId) : null,
  };
}
