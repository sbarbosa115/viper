import { sql, type Kysely } from 'kysely';

/** platform: Platform settings, Audit log, analytics events (PRD section 8, ADR 0012). */
const OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

const statements = [
  `CREATE TABLE settings (
    section VARCHAR(32) NOT NULL,
    value_json JSON NOT NULL COMMENT 'non-secret fields',
    secrets_enc JSON NULL COMMENT 'per secret field: ciphertext, iv, tag (AES-256-GCM), last4, updatedAt',
    updated_by CHAR(36) NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (section),
    KEY settings_updated_by (updated_by)
  ) ${OPTIONS}`,
  `CREATE TABLE audit_log (
    id CHAR(36) NOT NULL,
    at DATETIME(3) NOT NULL,
    staff_member_id CHAR(36) NOT NULL,
    business_id CHAR(36) NULL,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(64) NOT NULL,
    target_id VARCHAR(64) NULL,
    details JSON NOT NULL,
    PRIMARY KEY (id),
    KEY audit_log_business_at (business_id, at),
    KEY audit_log_staff_at (staff_member_id, at),
    KEY audit_log_action_at (action, at),
    KEY audit_log_at (at)
  ) ${OPTIONS}`,
  `CREATE TABLE analytics_events (
    id CHAR(36) NOT NULL,
    name VARCHAR(64) NOT NULL,
    business_id CHAR(36) NULL,
    member_id CHAR(36) NULL,
    properties JSON NOT NULL,
    at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY analytics_events_name_at (name, at),
    KEY analytics_events_business_at (business_id, at),
    KEY analytics_events_member_id (member_id),
    KEY analytics_events_at (at)
  ) ${OPTIONS}`,
];

const tables = ['analytics_events', 'audit_log', 'settings'];

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const statement of statements) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of tables) await sql.raw(`DROP TABLE IF EXISTS ${table}`).execute(db);
}
