import { sql, type Kysely } from 'kysely';

/**
 * research: what attempts, resumes and run emails need beyond the initial tables (FR-21, FR-22,
 * FR-32, FR-36).
 * - `attempt_limit`: attempts this run may use (the flow's max attempts, plus one per Owner
 *   "Try again" or Staff "Resume").
 * - `window_started_at` / `active_offset_seconds`: where the total-time and active-time limits
 *   start counting; a resume starts a fresh window.
 * - `run_state`: runner state that spans steps (Tools disabled for this run, failures in a row).
 * - `research_run_emails`: one row per (outbox event, recipient), so a run email is sent once even
 *   when its event is delivered twice.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `ALTER TABLE research_runs
        ADD COLUMN attempt_limit INT NULL AFTER attempts,
        ADD COLUMN window_started_at DATETIME(3) NULL AFTER started_at,
        ADD COLUMN active_offset_seconds INT NOT NULL DEFAULT 0 AFTER active_seconds,
        ADD COLUMN run_state JSON NULL COMMENT 'Tools disabled for the run, failures in a row'`,
    )
    .execute(db);
  await sql
    .raw(
      `CREATE TABLE research_run_emails (
        event_id VARCHAR(64) NOT NULL,
        recipient VARCHAR(16) NOT NULL COMMENT 'owner or support',
        run_id CHAR(36) NOT NULL,
        sent_at DATETIME(3) NOT NULL,
        PRIMARY KEY (event_id, recipient),
        KEY research_run_emails_run_id (run_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw('DROP TABLE IF EXISTS research_run_emails').execute(db);
  await sql
    .raw(
      `ALTER TABLE research_runs
        DROP COLUMN attempt_limit,
        DROP COLUMN window_started_at,
        DROP COLUMN active_offset_seconds,
        DROP COLUMN run_state`,
    )
    .execute(db);
}
