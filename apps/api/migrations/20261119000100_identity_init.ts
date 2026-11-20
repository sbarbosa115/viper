import { sql, type Kysely } from 'kysely';

/** identity: Businesses, Members, sessions, email tokens, login attempts (PRD section 8). */
const OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

const statements = [
  `CREATE TABLE businesses (
    id CHAR(36) NOT NULL,
    name VARCHAR(120) NOT NULL,
    internal TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL,
    last_active_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    KEY businesses_created_at (created_at),
    KEY businesses_last_active_at (last_active_at),
    KEY businesses_internal (internal),
    KEY businesses_name (name)
  ) ${OPTIONS}`,
  `CREATE TABLE members (
    id CHAR(36) NOT NULL,
    business_id CHAR(36) NOT NULL,
    email VARCHAR(254) NOT NULL,
    name VARCHAR(80) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    role ENUM('owner') NOT NULL DEFAULT 'owner',
    is_staff TINYINT(1) NOT NULL DEFAULT 0,
    email_verified_at DATETIME(3) NULL,
    totp_secret_enc VARBINARY(512) NULL,
    totp_enabled_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY members_email (email),
    KEY members_business_id (business_id),
    KEY members_is_staff (is_staff),
    KEY members_email_verified_at (email_verified_at),
    CONSTRAINT members_business_fk FOREIGN KEY (business_id) REFERENCES businesses (id)
  ) ${OPTIONS}`,
  `CREATE TABLE sessions (
    id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'sha-256 of the token, hex',
    member_id CHAR(36) NOT NULL,
    acting_as_business_id CHAR(36) NULL,
    two_factor_passed TINYINT(1) NOT NULL DEFAULT 0,
    two_factor_failures INT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL,
    last_seen_at DATETIME(3) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY sessions_member_id (member_id),
    KEY sessions_acting_as_business_id (acting_as_business_id),
    KEY sessions_expires_at (expires_at),
    CONSTRAINT sessions_member_fk FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE,
    CONSTRAINT sessions_acting_as_fk FOREIGN KEY (acting_as_business_id) REFERENCES businesses (id) ON DELETE SET NULL
  ) ${OPTIONS}`,
  `CREATE TABLE email_tokens (
    id CHAR(36) NOT NULL,
    member_id CHAR(36) NOT NULL,
    purpose ENUM('verify','reset') NOT NULL,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME(3) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    used_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY email_tokens_token_hash (token_hash),
    KEY email_tokens_member_purpose_created (member_id, purpose, created_at),
    CONSTRAINT email_tokens_member_fk FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE
  ) ${OPTIONS}`,
  `CREATE TABLE login_attempts (
    id CHAR(36) NOT NULL,
    email VARCHAR(254) NOT NULL,
    ip VARCHAR(45) NOT NULL,
    success TINYINT(1) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY login_attempts_email_created (email, created_at),
    KEY login_attempts_ip_created (ip, created_at)
  ) ${OPTIONS}`,
];

const tables = ['login_attempts', 'email_tokens', 'sessions', 'members', 'businesses'];

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const statement of statements) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of tables) await sql.raw(`DROP TABLE IF EXISTS ${table}`).execute(db);
}
