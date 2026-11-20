import { sql, type Kysely } from 'kysely';

/**
 * research: Research flows (versioned), runs, steps, attempts, handoffs and agent transcripts
 * (PRD section 8, ADR 0011, ADR 0017).
 */
const OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

const statements = [
  `CREATE TABLE research_flows (
    id CHAR(36) NOT NULL,
    \`key\` VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    version INT NOT NULL,
    settings JSON NOT NULL COMMENT '{ runSettings, planDefaults }',
    steps JSON NOT NULL COMMENT '[{ key, name, goal, tools, budgetPct, timeLimitMinutes, required }]',
    is_template TINYINT(1) NOT NULL DEFAULT 0,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    business_id CHAR(36) NULL,
    created_by CHAR(36) NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY research_flows_key_version (\`key\`, version),
    KEY research_flows_business_id (business_id),
    KEY research_flows_is_default (is_default),
    KEY research_flows_created_by (created_by)
  ) ${OPTIONS}`,
  `CREATE TABLE research_runs (
    id CHAR(36) NOT NULL,
    business_id CHAR(36) NOT NULL,
    plan_id CHAR(36) NOT NULL,
    flow_id CHAR(36) NOT NULL,
    flow_version INT NOT NULL,
    flow_settings JSON NOT NULL COMMENT 'snapshot of the flow settings and steps at start',
    plan_snapshot JSON NOT NULL,
    prompt_version VARCHAR(32) NULL,
    status ENUM('queued','running','retrying','completed','failed','cancelled') NOT NULL,
    started_by_member_id CHAR(36) NOT NULL,
    started_by_staff_id CHAR(36) NULL,
    attempts INT NOT NULL DEFAULT 0,
    active_seconds INT NOT NULL DEFAULT 0,
    next_attempt_at DATETIME(3) NULL,
    cancel_requested_at DATETIME(3) NULL,
    budget_reached TINYINT(1) NOT NULL DEFAULT 0,
    time_reached TINYINT(1) NOT NULL DEFAULT 0,
    failure_code VARCHAR(64) NULL,
    queued_at DATETIME(3) NOT NULL,
    started_at DATETIME(3) NULL,
    finished_at DATETIME(3) NULL,
    credits_reserved INT NOT NULL,
    credits_spent INT NOT NULL DEFAULT 0,
    millicredits_spent BIGINT NOT NULL DEFAULT 0,
    provider_cost_micros BIGINT NOT NULL DEFAULT 0,
    leads_delivered INT NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    KEY research_runs_business_status (business_id, status),
    KEY research_runs_plan_queued (plan_id, queued_at),
    KEY research_runs_flow_id (flow_id),
    KEY research_runs_status_next_attempt (status, next_attempt_at),
    KEY research_runs_started_by_member_id (started_by_member_id),
    KEY research_runs_started_by_staff_id (started_by_staff_id),
    KEY research_runs_queued_at (queued_at),
    KEY research_runs_status_finished (status, finished_at),
    CONSTRAINT research_runs_flow_fk FOREIGN KEY (flow_id) REFERENCES research_flows (id)
  ) ${OPTIONS}`,
  `CREATE TABLE run_steps (
    id CHAR(36) NOT NULL,
    run_id CHAR(36) NOT NULL,
    step_key VARCHAR(64) NOT NULL,
    position INT NOT NULL,
    status ENUM('pending','running','done','skipped','failed') NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    progress JSON NULL COMMENT 'work items done and remaining, saved after every Tool call',
    started_at DATETIME(3) NULL,
    finished_at DATETIME(3) NULL,
    millicredits_spent BIGINT NOT NULL DEFAULT 0,
    checkpoint JSON NULL,
    error VARCHAR(1000) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY run_steps_run_step (run_id, step_key),
    CONSTRAINT run_steps_run_fk FOREIGN KEY (run_id) REFERENCES research_runs (id) ON DELETE CASCADE
  ) ${OPTIONS}`,
  `CREATE TABLE run_attempts (
    id CHAR(36) NOT NULL,
    run_id CHAR(36) NOT NULL,
    n INT NOT NULL,
    status ENUM('running','completed','retryable_error','final_error','worker_stopped','cancelled') NOT NULL,
    from_step VARCHAR(64) NOT NULL,
    from_item INT NOT NULL DEFAULT 0,
    reached_step VARCHAR(64) NULL,
    reached_item INT NULL,
    error VARCHAR(1000) NULL,
    handoff JSON NULL COMMENT 'copy of the handoff when the attempt ended',
    lease_owner VARCHAR(128) NULL,
    lease_expires_at DATETIME(3) NULL,
    started_at DATETIME(3) NOT NULL,
    ended_at DATETIME(3) NULL,
    active_seconds INT NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY run_attempts_run_n (run_id, n),
    KEY run_attempts_status_lease (status, lease_expires_at),
    CONSTRAINT run_attempts_run_fk FOREIGN KEY (run_id) REFERENCES research_runs (id) ON DELETE CASCADE
  ) ${OPTIONS}`,
  `CREATE TABLE run_handoffs (
    run_id CHAR(36) NOT NULL,
    attempt_n INT NOT NULL,
    step_key VARCHAR(64) NOT NULL,
    items_done INT NOT NULL DEFAULT 0,
    items_left INT NOT NULL DEFAULT 0,
    notes VARCHAR(2000) NOT NULL DEFAULT '',
    last_error VARCHAR(1000) NULL,
    credits_left INT NOT NULL,
    active_seconds_left INT NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (run_id),
    CONSTRAINT run_handoffs_run_fk FOREIGN KEY (run_id) REFERENCES research_runs (id) ON DELETE CASCADE
  ) ${OPTIONS}`,
  `CREATE TABLE run_messages (
    id CHAR(36) NOT NULL,
    run_id CHAR(36) NOT NULL,
    attempt_n INT NOT NULL,
    step_key VARCHAR(64) NOT NULL,
    role VARCHAR(16) NOT NULL,
    content JSON NOT NULL,
    created_at DATETIME(3) NOT NULL COMMENT 'kept 90 days',
    PRIMARY KEY (id),
    KEY run_messages_run_attempt_created (run_id, attempt_n, created_at),
    KEY run_messages_created_at (created_at),
    CONSTRAINT run_messages_run_fk FOREIGN KEY (run_id) REFERENCES research_runs (id) ON DELETE CASCADE
  ) ${OPTIONS}`,
];

const tables = [
  'run_messages',
  'run_handoffs',
  'run_attempts',
  'run_steps',
  'research_runs',
  'research_flows',
];

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const statement of statements) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of tables) await sql.raw(`DROP TABLE IF EXISTS ${table}`).execute(db);
}
