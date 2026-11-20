import { sql, type Kysely } from 'kysely';

/** tools: Tool catalog with the Rate card, and metered Tool calls (PRD section 8, FR-23). */
const OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

const statements = [
  `CREATE TABLE tools (
    \`key\` VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    provider VARCHAR(64) NOT NULL,
    unit VARCHAR(32) NOT NULL,
    provider_cost_micros_per_unit BIGINT NOT NULL,
    credits_per_unit DECIMAL(10,3) NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    max_units_per_call INT NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (\`key\`),
    KEY tools_enabled (enabled)
  ) ${OPTIONS}`,
  `CREATE TABLE tool_calls (
    id CHAR(36) NOT NULL,
    run_id CHAR(36) NULL,
    step_key VARCHAR(64) NULL,
    attempt_n INT NULL,
    reused TINYINT(1) NOT NULL DEFAULT 0,
    business_id CHAR(36) NOT NULL,
    tool_key VARCHAR(64) NOT NULL,
    input_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    input JSON NOT NULL,
    output JSON NULL COMMENT 'kept 90 days',
    units INT NOT NULL DEFAULT 0,
    millicredits BIGINT NOT NULL DEFAULT 0,
    provider_cost_micros BIGINT NOT NULL DEFAULT 0,
    status ENUM('ok','error','skipped') NOT NULL,
    error VARCHAR(1000) NULL,
    duration_ms INT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    KEY tool_calls_run_step_tool_input (run_id, step_key, tool_key, input_hash),
    KEY tool_calls_tool_created (tool_key, created_at),
    KEY tool_calls_business_created (business_id, created_at),
    KEY tool_calls_created_at (created_at),
    CONSTRAINT tool_calls_tool_fk FOREIGN KEY (tool_key) REFERENCES tools (\`key\`)
  ) ${OPTIONS}`,
];

const tables = ['tool_calls', 'tools'];

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const statement of statements) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of tables) await sql.raw(`DROP TABLE IF EXISTS ${table}`).execute(db);
}
