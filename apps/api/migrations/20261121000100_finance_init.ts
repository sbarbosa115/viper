import { sql, type Kysely } from 'kysely';

/**
 * finance: Recurring bills and One-off expenses with price versions, Provider invoices, the
 * Budget and its per-month snapshots, and budget alerts (prd-expenses section 8, ADR 0020).
 * Charges, metered costs and the P&L are derived on read; nothing here is a ledger.
 */
const OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

const CATEGORIES = [
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
]
  .map((c) => `'${c}'`)
  .join(',');

const statements = [
  `CREATE TABLE expenses (
    id CHAR(36) NOT NULL,
    kind ENUM('recurring','one_off') NOT NULL,
    name VARCHAR(80) NOT NULL,
    vendor VARCHAR(80) NOT NULL,
    category ENUM(${CATEGORIES}) NOT NULL,
    cadence ENUM('monthly','yearly') NULL COMMENT 'null for a one-off',
    starts_on DATE NOT NULL COMMENT 'first charge date; a one-off''s spent-on date',
    ends_on DATE NULL,
    covers_provider VARCHAR(64) NULL COMMENT 'the Tool catalog provider name',
    link VARCHAR(2048) NULL,
    notes VARCHAR(500) NULL,
    created_by_member_id CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    deleted_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    KEY expenses_kind_deleted (kind, deleted_at),
    KEY expenses_covers_provider (covers_provider),
    KEY expenses_created_by_member_id (created_by_member_id)
  ) ${OPTIONS}`,
  `CREATE TABLE expense_prices (
    id CHAR(36) NOT NULL,
    expense_id CHAR(36) NOT NULL,
    effective_from DATE NOT NULL,
    amount_cents INT NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY expense_prices_expense_effective (expense_id, effective_from),
    CONSTRAINT expense_prices_expense_fk FOREIGN KEY (expense_id) REFERENCES expenses (id)
  ) ${OPTIONS}`,
  `CREATE TABLE provider_invoices (
    provider VARCHAR(64) NOT NULL COMMENT 'the Tool catalog provider name',
    month CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'YYYY-MM, UTC',
    amount_cents INT NOT NULL,
    note VARCHAR(200) NULL,
    entered_by_member_id CHAR(36) NOT NULL,
    entered_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (provider, month),
    KEY provider_invoices_month (month),
    KEY provider_invoices_entered_by_member_id (entered_by_member_id)
  ) ${OPTIONS}`,
  `CREATE TABLE finance_budgets (
    month CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'YYYY-MM, UTC',
    budget_cents INT NOT NULL,
    set_at DATETIME(3) NOT NULL,
    PRIMARY KEY (month)
  ) ${OPTIONS}`,
  `CREATE TABLE finance_settings (
    id TINYINT NOT NULL COMMENT 'always 1',
    monthly_budget_cents INT NOT NULL DEFAULT 30000,
    updated_by_member_id CHAR(36) NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY finance_settings_updated_by_member_id (updated_by_member_id)
  ) ${OPTIONS}`,
  `INSERT INTO finance_settings (id, monthly_budget_cents, updated_by_member_id, updated_at)
    VALUES (1, 30000, NULL, UTC_TIMESTAMP(3))`,
  `CREATE TABLE budget_alerts (
    month CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'YYYY-MM, UTC',
    threshold TINYINT NOT NULL COMMENT '80 or 100',
    spent_cents INT NOT NULL,
    budget_cents INT NOT NULL,
    sent_at DATETIME(3) NOT NULL,
    PRIMARY KEY (month, threshold)
  ) ${OPTIONS}`,
];

const tables = [
  'budget_alerts',
  'finance_settings',
  'finance_budgets',
  'provider_invoices',
  'expense_prices',
  'expenses',
];

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const statement of statements) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of tables) await sql.raw(`DROP TABLE IF EXISTS ${table}`).execute(db);
}
