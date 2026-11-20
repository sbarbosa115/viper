import { sql, type Kysely } from 'kysely';

/** billing: Credit ledger, Reservations, Credit packs, purchases (PRD section 8, ADR 0009). */
const OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

const statements = [
  `CREATE TABLE credit_packs (
    id CHAR(36) NOT NULL,
    name VARCHAR(60) NOT NULL,
    credits INT NOT NULL,
    price_cents INT NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    position INT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY credit_packs_active_position (active, position)
  ) ${OPTIONS}`,
  `CREATE TABLE purchases (
    id CHAR(36) NOT NULL,
    business_id CHAR(36) NOT NULL,
    pack_id CHAR(36) NOT NULL,
    credits INT NOT NULL COMMENT 'the pack credits at purchase time',
    stripe_session_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    stripe_event_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
    amount_cents INT NOT NULL,
    tax_cents INT NOT NULL DEFAULT 0,
    status ENUM('pending','paid') NOT NULL,
    created_at DATETIME(3) NOT NULL,
    paid_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY purchases_stripe_session_id (stripe_session_id),
    UNIQUE KEY purchases_stripe_event_id (stripe_event_id),
    KEY purchases_business_id (business_id),
    KEY purchases_pack_id (pack_id),
    KEY purchases_status_paid_at (status, paid_at),
    CONSTRAINT purchases_pack_fk FOREIGN KEY (pack_id) REFERENCES credit_packs (id)
  ) ${OPTIONS}`,
  `CREATE TABLE credit_ledger (
    id CHAR(36) NOT NULL,
    business_id CHAR(36) NOT NULL,
    type ENUM('grant','purchase','reservation','release','settlement','adjustment') NOT NULL,
    credits INT NOT NULL COMMENT 'signed',
    description VARCHAR(200) NOT NULL,
    run_id CHAR(36) NULL,
    purchase_id CHAR(36) NULL,
    idempotency_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'e.g. trial:<businessId>',
    created_by_member_id CHAR(36) NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY credit_ledger_idempotency_key (idempotency_key),
    KEY credit_ledger_business_created (business_id, created_at),
    KEY credit_ledger_run_id (run_id),
    KEY credit_ledger_purchase_id (purchase_id),
    KEY credit_ledger_created_by_member_id (created_by_member_id),
    KEY credit_ledger_type_created (type, created_at),
    CONSTRAINT credit_ledger_purchase_fk FOREIGN KEY (purchase_id) REFERENCES purchases (id)
  ) ${OPTIONS}`,
  `CREATE TABLE reservations (
    run_id CHAR(36) NOT NULL,
    business_id CHAR(36) NOT NULL,
    credits INT NOT NULL,
    status ENUM('open','settled','released') NOT NULL,
    created_at DATETIME(3) NOT NULL,
    closed_at DATETIME(3) NULL,
    PRIMARY KEY (run_id),
    KEY reservations_business_status (business_id, status)
  ) ${OPTIONS}`,
];

const tables = ['reservations', 'credit_ledger', 'purchases', 'credit_packs'];

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const statement of statements) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of tables) await sql.raw(`DROP TABLE IF EXISTS ${table}`).execute(db);
}
