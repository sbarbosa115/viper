import { sql, type Kysely } from 'kysely';

/**
 * tools: the P&L sums provider cost per Tool and month over 12 months of Tool calls. A covering
 * index on (created_at, tool_key, provider_cost_micros) answers it from the index alone (range
 * scan on created_at, no table reads), where (tool_key, created_at) would need one scan per Tool.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      'ALTER TABLE tool_calls ADD KEY tool_calls_created_tool_cost (created_at, tool_key, provider_cost_micros)',
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw('ALTER TABLE tool_calls DROP INDEX tool_calls_created_tool_cost').execute(db);
}
