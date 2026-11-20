import { sql, type Kysely } from 'kysely';

/**
 * tools: a provider call is stored as `started` before the provider is called, outside the
 * caller's transaction; its outcome (`ok` / `error`) is stored with the run's handoff after the
 * call (FR-19, FR-36). A row left `started` is a call whose worker stopped mid-call.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(`ALTER TABLE tool_calls MODIFY status ENUM('ok','error','skipped','started') NOT NULL`)
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`UPDATE tool_calls SET status = 'error' WHERE status = 'started'`).execute(db);
  await sql
    .raw(`ALTER TABLE tool_calls MODIFY status ENUM('ok','error','skipped') NOT NULL`)
    .execute(db);
}
