import type { ColumnType, Generated } from 'kysely';
import type { Timestamp } from '../../../shared/infrastructure/db/schema.js';

/**
 * DATE (a calendar day, no time). mysql2 reads it as a Date at 00:00 UTC (the pool's timezone is
 * `Z`); write it as `YYYY-MM-DD` so no time zone can shift the day.
 */
export type CalendarDate = ColumnType<Date, string, string>;

export type ExpenseCategoryColumn =
  | 'hosting'
  | 'data_providers'
  | 'ai'
  | 'email'
  | 'domain_dns'
  | 'payments_fees'
  | 'software_tools'
  | 'legal_admin'
  | 'marketing'
  | 'other';

/** A Recurring bill or a One-off expense; soft-deleted with `deleted_at`. */
export interface ExpensesTable {
  id: string;
  kind: 'recurring' | 'one_off';
  name: string;
  vendor: string;
  category: ExpenseCategoryColumn;
  /** null for a One-off. */
  cadence: 'monthly' | 'yearly' | null;
  /** The first charge date; a One-off's spent-on date. */
  starts_on: CalendarDate;
  ends_on: ColumnType<Date | null, string | null | undefined, string | null>;
  /** The Tool catalog provider name (e.g. `Google Maps Platform`), not its key. */
  covers_provider: string | null;
  link: string | null;
  notes: string | null;
  created_by_member_id: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

/** Price versions; a One-off has exactly one (effective_from = starts_on). */
export interface ExpensePricesTable {
  id: string;
  expense_id: string;
  effective_from: CalendarDate;
  amount_cents: number;
}

/** One per provider and month (PK provider, month). */
export interface ProviderInvoicesTable {
  /** The Tool catalog provider name. */
  provider: string;
  /** `YYYY-MM`, UTC. */
  month: string;
  amount_cents: number;
  note: string | null;
  entered_by_member_id: string;
  entered_at: Timestamp;
  updated_at: Timestamp;
}

/** The Budget in effect for a month, snapshotted when first read or alerted. */
export interface FinanceBudgetsTable {
  month: string;
  budget_cents: number;
  set_at: Timestamp;
}

/** One row, id = 1 (seeded by the migration). */
export interface FinanceSettingsTable {
  id: number;
  monthly_budget_cents: Generated<number>;
  updated_by_member_id: string | null;
  updated_at: Timestamp;
}

/** One per month and threshold (80, 100): the alert is sent once. */
export interface BudgetAlertsTable {
  month: string;
  threshold: 80 | 100;
  spent_cents: number;
  budget_cents: number;
  sent_at: Timestamp;
}

export interface FinanceTables {
  expenses: ExpensesTable;
  expense_prices: ExpensePricesTable;
  provider_invoices: ProviderInvoicesTable;
  finance_budgets: FinanceBudgetsTable;
  finance_settings: FinanceSettingsTable;
  budget_alerts: BudgetAlertsTable;
}
