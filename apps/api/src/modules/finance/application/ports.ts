import type { AnalyticsTracker } from '../../../shared/application/analytics-tracker.js';
import type { EventPublisher } from '../../../shared/application/event-publisher.js';
import type { Clock } from '../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import type { BudgetThreshold } from '../domain/budget.js';
import type { MonthKey } from '../domain/calendar.js';
import type { Expense } from '../domain/expense.js';
import type { InvoiceFact, Refund, Sale } from '../domain/pnl.js';

/**
 * finance reads other contexts only through these ports (prd-expenses section 7, module ports);
 * composition.ts adapts the owning modules' public functions to them. Months are `YYYY-MM`, the
 * UTC calendar month [start, next start).
 */

// billing -----------------------------------------------------------------------------------------

export interface MonthRevenue {
  /** `YYYY-MM`. */
  month: MonthKey;
  /** Paid Purchases with `paid_at` in the month. */
  sales: Sale[];
  /** One item per refund event in the month: its delta, gross incl. tax (finance nets tax, FR-7). */
  refunds: Refund[];
}

export interface BillingRevenue {
  /** Every month from `fromMonth` to `toMonth` inclusive, oldest first, empty months included. */
  revenueForMonths(fromMonth: MonthKey, toMonth: MonthKey): Promise<MonthRevenue[]>;
}

// tools -------------------------------------------------------------------------------------------

export interface ToolsMetering {
  /**
   * Sum of `tool_calls.provider_cost_micros` per month and catalog provider, calls created from
   * `fromMonth` to `toMonth` inclusive; months or providers with no cost are left out.
   */
  meteredCostByProviderMonths(
    fromMonth: MonthKey,
    toMonth: MonthKey,
  ): Promise<{ month: MonthKey; provider: string; micros: number }[]>;
  /** The Tool catalog's distinct providers (display names) and their Tool keys. */
  providers(): Promise<{ name: string; toolKeys: string[] }[]>;
}

// identity ----------------------------------------------------------------------------------------

export interface StaffRecipient {
  memberId: string;
  email: string;
  name: string;
}

export interface StaffDirectory {
  /** Every Staff Member (budget alert recipients, FR-12). */
  staffRecipients(): Promise<StaffRecipient[]>;
}

export interface MemberDirectory {
  /** Emails by Member id, in one batch; unknown ids are left out (identity.getMemberEmails). */
  memberEmails(memberIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

// platform ----------------------------------------------------------------------------------------

export interface FinanceAuditRecord {
  staffMemberId: string;
  businessId: string | null;
  action: string;
  targetType: 'expense' | 'provider_invoice' | 'budget' | 'pnl';
  targetId: string | null;
  details?: Record<string, unknown>;
}

/** platform's Audit log; `within` is the open transaction the entry commits with. */
export interface FinanceAudit {
  record(entry: FinanceAuditRecord, within?: object): Promise<void>;
}

// finance's own storage ----------------------------------------------------------------------------

export interface ExpenseRepository {
  /** Not deleted; null otherwise. */
  findById(id: string): Promise<Expense | null>;
  /** Every Expense not deleted (fewer than 200). */
  listAll(): Promise<Expense[]>;
  save(expense: Expense): Promise<void>;
  /**
   * Inside `run` only: holds finance's coverage mutex until the transaction ends (FR-2), so
   * coverage checks and the writes after them happen one at a time. Call it before any read.
   */
  lockCoverage(): Promise<void>;
}

export interface ProviderInvoiceRepository {
  forMonths(months: readonly MonthKey[]): Promise<InvoiceFact[]>;
  find(provider: string, month: MonthKey): Promise<InvoiceFact | null>;
  save(invoice: InvoiceFact, now: Date): Promise<void>;
  delete(provider: string, month: MonthKey): Promise<void>;
}

export interface BudgetSettings {
  monthlyBudgetCents: number;
  updatedByMemberId: string | null;
  updatedAt: Date;
}

export interface BudgetRepository {
  settings(): Promise<BudgetSettings>;
  saveSettings(settings: BudgetSettings): Promise<void>;
  /** The Budget in effect for a month, if snapshotted. */
  snapshot(month: MonthKey): Promise<number | null>;
  /** Writes the month's snapshot; `replace` overwrites one already there. */
  saveSnapshot(month: MonthKey, budgetCents: number, at: Date, replace: boolean): Promise<void>;
  alertsSent(month: MonthKey): Promise<BudgetThreshold[]>;
  /**
   * Records an alert (unique month + threshold); false when it was already recorded, so two
   * concurrent budget checks cannot both send (FR-12).
   */
  insertAlert(
    month: MonthKey,
    threshold: BudgetThreshold,
    spentCents: number,
    budgetCents: number,
    at: Date,
  ): Promise<boolean>;
  /** Test hook only: forgets a month's alerts. */
  clearAlerts(month: MonthKey): Promise<void>;
}

/** Outbox events finance publishes (a subset of the shared outbox event map). */
export interface FinanceEvents {
  BudgetAlertRecorded: { month: MonthKey; threshold: BudgetThreshold };
}

export interface FinanceRepos {
  expenses: ExpenseRepository;
  invoices: ProviderInvoiceRepository;
  budgets: BudgetRepository;
  /** The Audit log inside this unit of work's transaction. */
  audit: { record(entry: FinanceAuditRecord): Promise<void> };
  /** The outbox inside this unit of work's transaction: published if and only if it commits. */
  events: EventPublisher<FinanceEvents>;
}

export interface FinanceStore {
  /** One transaction: the writes and their Audit entries commit together. */
  run<T>(fn: (repos: FinanceRepos) => Promise<T>): Promise<T>;
  /** Reads outside a transaction. */
  readonly read: Omit<FinanceRepos, 'audit' | 'events'>;
}

// Everything the use cases need ---------------------------------------------------------------------

export interface FinanceSources {
  billing: BillingRevenue;
  tools: ToolsMetering;
  staff: StaffDirectory;
  members: MemberDirectory;
}

export interface FinanceContext extends FinanceSources {
  store: FinanceStore;
  analytics: AnalyticsTracker;
  clock: Clock;
  ids: IdGenerator;
}
