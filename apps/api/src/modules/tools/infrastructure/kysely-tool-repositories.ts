import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import type { DB } from '../../../shared/infrastructure/db/schema.js';
import type {
  ToolCallRecord,
  ToolCallRepository,
  ToolRepository,
  ToolSpend,
} from '../application/ports.js';
import type { ToolStats } from '../domain/health.js';
import type { ToolSnapshot } from '../domain/tool.js';
import type { ToolCallsTable } from './tables.js';

type Db = Kysely<DB> | Transaction<DB>;

export class KyselyToolRepository implements ToolRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<ToolSnapshot[]> {
    const rows = await this.db.selectFrom('tools').selectAll().orderBy('key').execute();
    return rows.map(toSnapshot);
  }

  async find(key: string): Promise<ToolSnapshot | null> {
    const row = await this.db
      .selectFrom('tools')
      .selectAll()
      .where('key', '=', key)
      .executeTakeFirst();
    return row ? toSnapshot(row) : null;
  }

  async save(tool: ToolSnapshot): Promise<void> {
    const values = {
      name: tool.name,
      provider: tool.provider,
      unit: tool.unit,
      provider_cost_micros_per_unit: tool.providerCostMicrosPerUnit,
      credits_per_unit: tool.creditsPerUnit,
      enabled: tool.enabled,
      max_units_per_call: tool.maxUnitsPerCall,
      updated_at: tool.updatedAt,
    };
    await this.db
      .insertInto('tools')
      .values({ key: tool.key, ...values })
      .onDuplicateKeyUpdate(values)
      .execute();
  }
}

function toSnapshot(row: Selectable<DB['tools']>): ToolSnapshot {
  return {
    key: row.key,
    name: row.name,
    provider: row.provider,
    unit: row.unit,
    providerCostMicrosPerUnit: Number(row.provider_cost_micros_per_unit),
    creditsPerUnit: Number(row.credits_per_unit),
    enabled: Boolean(row.enabled),
    maxUnitsPerCall: row.max_units_per_call,
    updatedAt: row.updated_at,
  };
}

function toRecord(row: Selectable<ToolCallsTable>): ToolCallRecord {
  return {
    id: row.id,
    runId: row.run_id,
    stepKey: row.step_key,
    attemptN: row.attempt_n,
    reused: Boolean(row.reused),
    businessId: row.business_id,
    toolKey: row.tool_key,
    inputHash: row.input_hash,
    input: row.input,
    output: row.output,
    units: row.units,
    millicredits: Number(row.millicredits),
    providerCostMicros: Number(row.provider_cost_micros),
    status: row.status,
    error: row.error,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

export class KyselyToolCallRepository implements ToolCallRepository {
  constructor(private readonly db: Db) {}

  async add(records: readonly ToolCallRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.db
      .insertInto('tool_calls')
      .values(
        records.map((r) => ({
          id: r.id,
          run_id: r.runId,
          step_key: r.stepKey,
          attempt_n: r.attemptN,
          reused: r.reused,
          business_id: r.businessId,
          tool_key: r.toolKey,
          input_hash: r.inputHash,
          input: JSON.stringify(r.input ?? null),
          output: r.output === null || r.output === undefined ? null : JSON.stringify(r.output),
          units: r.units,
          millicredits: r.millicredits,
          provider_cost_micros: r.providerCostMicros,
          status: r.status,
          error: r.error,
          duration_ms: r.durationMs,
          created_at: r.createdAt,
        })),
      )
      .execute();
  }

  async complete(r: ToolCallRecord): Promise<void> {
    await this.db
      .updateTable('tool_calls')
      .set({
        output: r.output === null || r.output === undefined ? null : JSON.stringify(r.output),
        units: r.units,
        millicredits: r.millicredits,
        provider_cost_micros: r.providerCostMicros,
        status: r.status,
        error: r.error,
        duration_ms: r.durationMs,
      })
      .where('id', '=', r.id)
      .where('status', '=', 'started')
      .execute();
  }

  async findReusable(q: {
    runId: string;
    stepKey: string | null;
    toolKey: string;
    inputHash: string;
  }): Promise<ToolCallRecord | null> {
    let query = this.db
      .selectFrom('tool_calls')
      .selectAll()
      .where('run_id', '=', q.runId)
      .where('tool_key', '=', q.toolKey)
      .where('input_hash', '=', q.inputHash)
      .where('status', '=', 'ok')
      .where('reused', '=', 0);
    query =
      q.stepKey === null
        ? query.where('step_key', 'is', null)
        : query.where('step_key', '=', q.stepKey);
    const row = await query.orderBy('created_at').orderBy('id').limit(1).executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async spendBetween(window: { from: Date; to: Date }): Promise<ToolSpend[]> {
    const rows = await this.db
      .selectFrom('tool_calls')
      .select((eb) => [
        'tool_key',
        eb.fn.sum<number>('provider_cost_micros').as('cost'),
        eb.fn.countAll<number>().as('calls'),
        sql<number>`SUM(status = 'error')`.as('errors'),
      ])
      .where('created_at', '>=', window.from)
      .where('created_at', '<', window.to)
      .where('reused', '=', 0)
      .where('status', 'in', ['ok', 'error'])
      .groupBy('tool_key')
      .execute();
    return rows.map((r) => ({
      toolKey: r.tool_key,
      providerCostMicros: Number(r.cost ?? 0),
      calls: Number(r.calls),
      errors: Number(r.errors ?? 0),
    }));
  }

  async statsSince(since: Date): Promise<Map<string, ToolStats>> {
    const counted = this.db
      .selectFrom('tool_calls')
      .where('created_at', '>=', since)
      .where('reused', '=', 0)
      .where('status', 'in', ['ok', 'error']);
    const [totals, lastErrors] = await Promise.all([
      counted
        .select([
          'tool_key',
          (eb) => eb.fn.countAll<number>().as('calls'),
          sql<number>`SUM(status = 'error')`.as('errors'),
        ])
        .groupBy('tool_key')
        .execute(),
      // The newest error per Tool: one row per Tool via ROW_NUMBER (MySQL 8).
      this.db
        .selectFrom((eb) =>
          eb
            .selectFrom('tool_calls')
            .where('created_at', '>=', since)
            .where('reused', '=', 0)
            .where('status', '=', 'error')
            .select([
              'tool_key',
              'error',
              'created_at',
              sql<number>`ROW_NUMBER() OVER (PARTITION BY tool_key ORDER BY created_at DESC, id DESC)`.as(
                'rn',
              ),
            ])
            .as('e'),
        )
        .select(['e.tool_key', 'e.error', 'e.created_at'])
        .where('e.rn', '=', 1)
        .execute(),
    ]);
    const last = new Map(lastErrors.map((e) => [e.tool_key, e]));
    return new Map(
      totals.map((t) => [
        t.tool_key,
        {
          calls: Number(t.calls),
          errors: Number(t.errors ?? 0),
          lastErrorAt: last.get(t.tool_key)?.created_at ?? null,
          lastError: last.get(t.tool_key)?.error ?? null,
        },
      ]),
    );
  }

  async listForRun(runId: string): Promise<ToolCallRecord[]> {
    const rows = await this.db
      .selectFrom('tool_calls')
      .selectAll()
      .where('run_id', '=', runId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map(toRecord);
  }
}
