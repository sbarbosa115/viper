import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import type { Clock } from '../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import type { DB } from '../../../shared/infrastructure/db/schema.js';
import type { OutboxEvents } from '../../../shared/infrastructure/outbox/events.js';
import { KyselyOutbox } from '../../../shared/infrastructure/outbox/outbox.js';
import type {
  AttemptRecord,
  AttemptRepository,
  FlowRepository,
  HandoffRecord,
  HandoffRepository,
  HandoffValues,
  MessageRepository,
  ReportWindow,
  ResearchStore,
  ResearchTx,
  RunEmailLog,
  RunFact,
  RunPageCursor,
  RunRepository,
  StaffRunFilter,
  StepProgress,
  StepRecord,
  StepRepository,
} from '../application/ports.js';
import type { FlowSettingsSnapshot, FlowStepDefinition, FlowVersion } from '../domain/flow.js';
import {
  ACTIVE_STATUSES,
  ResearchRun,
  type PlanSnapshot,
  type RunFailureCode,
  type RunnerState,
  type RunStatus,
} from '../domain/run.js';
import type {
  ResearchFlowsTable,
  ResearchRunsTable,
  RunAttemptsTable,
  RunHandoffsTable,
  RunStepsTable,
} from './tables.js';

type Trx = Transaction<DB>;
type Db = Kysely<DB> | Trx;

const json = (value: unknown) => JSON.stringify(value);

// Flows ------------------------------------------------------------------------------------------

function toFlow(row: Selectable<ResearchFlowsTable>): FlowVersion {
  const settings = row.settings as unknown as Pick<
    FlowSettingsSnapshot,
    'runSettings' | 'planDefaults'
  >;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    version: row.version,
    runSettings: settings.runSettings,
    planDefaults: settings.planDefaults,
    steps: row.steps as unknown as FlowStepDefinition[],
    isDefault: row.is_default === 1,
    isTemplate: row.is_template === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

class KyselyFlowRepository implements FlowRepository {
  constructor(private readonly db: Db) {}

  async latest(key: string): Promise<FlowVersion | null> {
    const row = await this.db
      .selectFrom('research_flows')
      .selectAll()
      .where('key', '=', key)
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? toFlow(row) : null;
  }

  async listLatest(): Promise<FlowVersion[]> {
    const rows = await this.db
      .selectFrom('research_flows as f')
      .selectAll('f')
      .where((eb) =>
        eb(
          'f.version',
          '=',
          eb
            .selectFrom('research_flows as g')
            .select((g) => g.fn.max('g.version').as('v'))
            .whereRef('g.key', '=', 'f.key'),
        ),
      )
      .orderBy('f.is_default', 'desc')
      .orderBy('f.key')
      .execute();
    return rows.map(toFlow);
  }

  async insert(flow: FlowVersion): Promise<void> {
    await this.db
      .insertInto('research_flows')
      .values({
        id: flow.id,
        key: flow.key,
        name: flow.name,
        version: flow.version,
        settings: json({ runSettings: flow.runSettings, planDefaults: flow.planDefaults }),
        steps: json(flow.steps),
        is_template: flow.isTemplate,
        is_default: flow.isDefault,
        business_id: null,
        created_by: flow.createdBy,
        created_at: flow.createdAt,
      })
      .execute();
  }

  async plansUsing(keys: readonly string[]): Promise<ReadonlyMap<string, number>> {
    if (keys.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('research_runs as r')
      .innerJoin('research_flows as f', 'f.id', 'r.flow_id')
      .select(['f.key', (eb) => eb.fn.count<number>('r.plan_id').distinct().as('plans')])
      .where('f.key', 'in', [...keys])
      .groupBy('f.key')
      .execute();
    return new Map(rows.map((r) => [r.key, Number(r.plans)]));
  }
}

// Runs -------------------------------------------------------------------------------------------

function toRun(row: Selectable<ResearchRunsTable>): ResearchRun {
  const flow = row.flow_settings as unknown as FlowSettingsSnapshot;
  const state = (row.run_state as unknown as RunnerState | null) ?? {
    disabledTools: [],
    failuresInARow: {},
  };
  return ResearchRun.restore({
    id: row.id,
    businessId: row.business_id,
    planId: row.plan_id,
    flowId: row.flow_id,
    flow,
    plan: row.plan_snapshot as unknown as PlanSnapshot,
    promptVersion: row.prompt_version ?? '',
    status: row.status,
    startedByMemberId: row.started_by_member_id,
    startedByStaffId: row.started_by_staff_id,
    attempts: row.attempts,
    attemptLimit: row.attempt_limit ?? flow.runSettings.maxAttempts,
    activeSeconds: row.active_seconds,
    activeOffsetSeconds: row.active_offset_seconds,
    nextAttemptAt: row.next_attempt_at,
    cancelRequestedAt: row.cancel_requested_at,
    budgetReached: row.budget_reached === 1,
    timeReached: row.time_reached === 1,
    failureCode: row.failure_code as RunFailureCode | null,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    windowStartedAt: row.window_started_at,
    finishedAt: row.finished_at,
    creditsReserved: row.credits_reserved,
    creditsSpent: row.credits_spent,
    millicreditsSpent: Number(row.millicredits_spent),
    providerCostMicros: Number(row.provider_cost_micros),
    leadsDelivered: row.leads_delivered,
    state,
  });
}

function runRow(run: ResearchRun) {
  const s = run.toSnapshot();
  return {
    id: s.id,
    business_id: s.businessId,
    plan_id: s.planId,
    flow_id: s.flowId,
    flow_version: s.flow.version,
    flow_settings: json(s.flow),
    plan_snapshot: json(s.plan),
    prompt_version: s.promptVersion,
    status: s.status,
    started_by_member_id: s.startedByMemberId,
    started_by_staff_id: s.startedByStaffId,
    attempts: s.attempts,
    attempt_limit: s.attemptLimit,
    active_seconds: s.activeSeconds,
    active_offset_seconds: s.activeOffsetSeconds,
    run_state: json(s.state),
    next_attempt_at: s.nextAttemptAt,
    cancel_requested_at: s.cancelRequestedAt,
    budget_reached: s.budgetReached,
    time_reached: s.timeReached,
    failure_code: s.failureCode,
    queued_at: s.queuedAt,
    started_at: s.startedAt,
    window_started_at: s.windowStartedAt,
    finished_at: s.finishedAt,
    credits_reserved: s.creditsReserved,
    credits_spent: s.creditsSpent,
    millicredits_spent: s.millicreditsSpent,
    provider_cost_micros: s.providerCostMicros,
    leads_delivered: s.leadsDelivered,
  };
}

class KyselyRunRepository implements RunRepository {
  constructor(private readonly db: Db) {}

  async find(id: string): Promise<ResearchRun | null> {
    const row = await this.db
      .selectFrom('research_runs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toRun(row) : null;
  }

  async findForUpdate(id: string): Promise<ResearchRun | null> {
    const row = await this.db
      .selectFrom('research_runs')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    return row ? toRun(row) : null;
  }

  async findByIds(ids: readonly string[]): Promise<ResearchRun[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .selectFrom('research_runs')
      .selectAll()
      .where('id', 'in', [...new Set(ids)])
      .execute();
    return rows.map(toRun);
  }

  async insert(run: ResearchRun): Promise<void> {
    await this.db.insertInto('research_runs').values(runRow(run)).execute();
  }

  async save(run: ResearchRun): Promise<void> {
    const { id: _id, ...row } = runRow(run);
    await this.db.updateTable('research_runs').set(row).where('id', '=', run.id).execute();
  }

  async hasActive(businessId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('research_runs')
      .select('id')
      .where('business_id', '=', businessId)
      .where('status', 'in', [...ACTIVE_STATUSES])
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  async listForPlan(
    businessId: string,
    planId: string,
    page: { after?: RunPageCursor; limit: number },
  ) {
    let q = this.db
      .selectFrom('research_runs')
      .selectAll()
      .where('business_id', '=', businessId)
      .where('plan_id', '=', planId);
    if (page.after) {
      const c = page.after;
      q = q.where((eb) =>
        eb.or([
          eb('queued_at', '<', c.queuedAt),
          eb.and([eb('queued_at', '=', c.queuedAt), eb('id', '<', c.id)]),
        ]),
      );
    }
    const rows = await q
      .orderBy('queued_at', 'desc')
      .orderBy('id', 'desc')
      .limit(page.limit)
      .execute();
    return rows.map(toRun);
  }

  async listForStaff(filter: StaffRunFilter, page: { after?: RunPageCursor; limit: number }) {
    let q = this.db.selectFrom('research_runs').selectAll();
    if (filter.status) q = q.where('status', '=', filter.status);
    if (filter.businessId) q = q.where('business_id', '=', filter.businessId);
    if (page.after) {
      const c = page.after;
      q = q.where((eb) =>
        eb.or([
          eb('queued_at', '<', c.queuedAt),
          eb.and([eb('queued_at', '=', c.queuedAt), eb('id', '<', c.id)]),
        ]),
      );
    }
    const rows = await q
      .orderBy('queued_at', 'desc')
      .orderBy('id', 'desc')
      .limit(page.limit)
      .execute();
    return rows.map(toRun);
  }

  async latestForPlans(businessId: string, planIds: readonly string[]): Promise<ResearchRun[]> {
    if (planIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('research_runs as r')
      .selectAll('r')
      .where('r.business_id', '=', businessId)
      .where('r.plan_id', 'in', [...planIds])
      .where((eb) =>
        eb(
          'r.id',
          '=',
          eb
            .selectFrom('research_runs as x')
            .select('x.id')
            .whereRef('x.plan_id', '=', 'r.plan_id')
            .where('x.business_id', '=', businessId)
            .orderBy('x.queued_at', 'desc')
            .orderBy('x.id', 'desc')
            .limit(1),
        ),
      )
      .execute();
    return rows.map(toRun);
  }

  async recentForBusiness(businessId: string, since: Date, limit: number): Promise<ResearchRun[]> {
    const rows = await this.db
      .selectFrom('research_runs')
      .selectAll()
      .where('business_id', '=', businessId)
      .where(sql<boolean>`COALESCE(started_at, queued_at) >= ${since}`)
      .orderBy(sql`COALESCE(started_at, queued_at)`, 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
    return rows.map(toRun);
  }

  async recentCompletedCredits(flowKey: string, limit: number): Promise<number[]> {
    const rows = await this.db
      .selectFrom('research_runs as r')
      .innerJoin('research_flows as f', 'f.id', 'r.flow_id')
      .select('r.credits_spent')
      .where('f.key', '=', flowKey)
      .where('r.status', '=', 'completed')
      .where('r.leads_delivered', '>=', 1)
      .orderBy('r.finished_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => r.credits_spent);
  }

  async dueRetries(before: Date, limit: number): Promise<ResearchRun[]> {
    const rows = await this.db
      .selectFrom('research_runs')
      .selectAll()
      .where('status', '=', 'retrying')
      .where('next_attempt_at', '<=', before)
      .limit(limit)
      .execute();
    return rows.map(toRun);
  }

  async staleQueued(before: Date, limit: number): Promise<ResearchRun[]> {
    const rows = await this.db
      .selectFrom('research_runs')
      .selectAll()
      .where('status', '=', 'queued')
      .where('queued_at', '<=', before)
      .limit(limit)
      .execute();
    return rows.map(toRun);
  }

  async countByStatus(status: RunStatus): Promise<number> {
    const row = await this.db
      .selectFrom('research_runs')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('status', '=', status)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  /** One range scan on queued_at; the Plan fields come out of plan_snapshot in SQL. */
  async factsQueuedIn(window: ReportWindow): Promise<RunFact[]> {
    const rows = await this.db
      .selectFrom('research_runs')
      .select([
        'id',
        'business_id',
        'status',
        'queued_at',
        'started_at',
        'finished_at',
        'credits_spent',
        'provider_cost_micros',
        'leads_delivered',
        'failure_code',
        sql<number>`CAST(JSON_EXTRACT(plan_snapshot, '$.guardrails.maxCredits') AS SIGNED)`.as(
          'max_credits',
        ),
        sql<number>`JSON_UNQUOTE(JSON_EXTRACT(plan_snapshot, '$.icpEdited')) = 'true'`.as(
          'icp_edited',
        ),
      ])
      .where('queued_at', '>=', window.from)
      .where('queued_at', '<', window.to)
      .execute();
    return rows.map((r) => ({
      runId: r.id,
      businessId: r.business_id,
      status: r.status,
      queuedAt: r.queued_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      creditsSpent: Number(r.credits_spent),
      maxCredits: Number(r.max_credits ?? 0),
      providerCostMicros: Number(r.provider_cost_micros),
      leadsDelivered: Number(r.leads_delivered),
      icpEdited: Number(r.icp_edited) === 1,
      failureCode: r.failure_code,
    }));
  }

  async countByBusiness(businessIds: readonly string[]): Promise<Map<string, number>> {
    if (businessIds.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('research_runs')
      .select((eb) => ['business_id', eb.fn.countAll<number>().as('n')])
      .where('business_id', 'in', [...new Set(businessIds)])
      .groupBy('business_id')
      .execute();
    return new Map(rows.map((r) => [r.business_id, Number(r.n)]));
  }
}

// Steps, attempts, handoffs, messages, emails ----------------------------------------------------

function toStep(row: Selectable<RunStepsTable>): StepRecord {
  return {
    id: row.id,
    runId: row.run_id,
    key: row.step_key,
    position: row.position,
    status: row.status,
    attempts: row.attempts,
    progress: row.progress as unknown as StepProgress | null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    millicreditsSpent: Number(row.millicredits_spent),
    checkpoint: row.checkpoint,
    error: row.error,
  };
}

function stepRow(s: StepRecord) {
  return {
    id: s.id,
    run_id: s.runId,
    step_key: s.key,
    position: s.position,
    status: s.status,
    attempts: s.attempts,
    progress: s.progress ? json(s.progress) : null,
    started_at: s.startedAt,
    finished_at: s.finishedAt,
    millicredits_spent: s.millicreditsSpent,
    checkpoint: s.checkpoint ? json(s.checkpoint) : null,
    error: s.error,
  };
}

class KyselyStepRepository implements StepRepository {
  constructor(private readonly db: Db) {}

  async list(runId: string): Promise<StepRecord[]> {
    const rows = await this.db
      .selectFrom('run_steps')
      .selectAll()
      .where('run_id', '=', runId)
      .orderBy('position')
      .execute();
    return rows.map(toStep);
  }

  async listForRuns(runIds: readonly string[]): Promise<ReadonlyMap<string, StepRecord[]>> {
    const map = new Map<string, StepRecord[]>(runIds.map((id) => [id, []]));
    if (runIds.length === 0) return map;
    const rows = await this.db
      .selectFrom('run_steps')
      .selectAll()
      .where('run_id', 'in', [...runIds])
      .orderBy('position')
      .execute();
    for (const row of rows) map.get(row.run_id)?.push(toStep(row));
    return map;
  }

  async insertMany(steps: readonly StepRecord[]): Promise<void> {
    if (steps.length === 0) return;
    await this.db.insertInto('run_steps').values(steps.map(stepRow)).execute();
  }

  async save(step: StepRecord): Promise<void> {
    const { id: _id, run_id: _r, step_key: _k, ...row } = stepRow(step);
    await this.db
      .updateTable('run_steps')
      .set(row)
      .where('run_id', '=', step.runId)
      .where('step_key', '=', step.key)
      .execute();
  }
}

function toAttempt(row: Selectable<RunAttemptsTable>): AttemptRecord {
  return {
    id: row.id,
    runId: row.run_id,
    n: row.n,
    status: row.status,
    fromStep: row.from_step,
    fromItem: row.from_item,
    reachedStep: row.reached_step,
    reachedItem: row.reached_item,
    error: row.error,
    handoff: row.handoff as unknown as HandoffValues | null,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    activeSeconds: row.active_seconds,
  };
}

function attemptRow(a: AttemptRecord) {
  return {
    id: a.id,
    run_id: a.runId,
    n: a.n,
    status: a.status,
    from_step: a.fromStep,
    from_item: a.fromItem,
    reached_step: a.reachedStep,
    reached_item: a.reachedItem,
    error: a.error,
    handoff: a.handoff ? json(a.handoff) : null,
    lease_owner: a.leaseOwner,
    lease_expires_at: a.leaseExpiresAt,
    started_at: a.startedAt,
    ended_at: a.endedAt,
    active_seconds: a.activeSeconds,
  };
}

class KyselyAttemptRepository implements AttemptRepository {
  constructor(private readonly db: Db) {}

  async insert(attempt: AttemptRecord): Promise<void> {
    await this.db.insertInto('run_attempts').values(attemptRow(attempt)).execute();
  }

  async save(attempt: AttemptRecord): Promise<void> {
    const { id: _id, run_id: _r, n: _n, ...row } = attemptRow(attempt);
    await this.db
      .updateTable('run_attempts')
      .set(row)
      .where('run_id', '=', attempt.runId)
      .where('n', '=', attempt.n)
      .execute();
  }

  async latest(runId: string): Promise<AttemptRecord | null> {
    const row = await this.db
      .selectFrom('run_attempts')
      .selectAll()
      .where('run_id', '=', runId)
      .orderBy('n', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? toAttempt(row) : null;
  }

  async list(runId: string): Promise<AttemptRecord[]> {
    const rows = await this.db
      .selectFrom('run_attempts')
      .selectAll()
      .where('run_id', '=', runId)
      .orderBy('n')
      .execute();
    return rows.map(toAttempt);
  }

  async expiredLeases(now: Date, limit: number): Promise<AttemptRecord[]> {
    const rows = await this.db
      .selectFrom('run_attempts')
      .selectAll()
      .where('status', '=', 'running')
      .where('lease_expires_at', '<', now)
      .limit(limit)
      .execute();
    return rows.map(toAttempt);
  }

  async findForUpdate(runId: string, n: number): Promise<AttemptRecord | null> {
    const row = await this.db
      .selectFrom('run_attempts')
      .selectAll()
      .where('run_id', '=', runId)
      .where('n', '=', n)
      .forUpdate()
      .executeTakeFirst();
    return row ? toAttempt(row) : null;
  }

  async renewLease(runId: string, n: number, owner: string, until: Date): Promise<boolean> {
    // One conditional update: no read lock held while the caller works (FR-36). MySQL counts
    // matched rows (mysql2 sets FOUND_ROWS), so renewing to the same time still returns true.
    const result = await this.db
      .updateTable('run_attempts')
      .set({ lease_expires_at: until })
      .where('run_id', '=', runId)
      .where('n', '=', n)
      .where('status', '=', 'running')
      .where('lease_owner', '=', owner)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }
}

function toHandoff(row: Selectable<RunHandoffsTable>): HandoffRecord {
  return {
    runId: row.run_id,
    attemptN: row.attempt_n,
    stepKey: row.step_key,
    itemsDone: row.items_done,
    itemsLeft: row.items_left,
    notes: row.notes,
    lastError: row.last_error,
    creditsLeft: row.credits_left,
    activeSecondsLeft: row.active_seconds_left,
    updatedAt: row.updated_at,
  };
}

class KyselyHandoffRepository implements HandoffRepository {
  constructor(private readonly db: Db) {}

  async get(runId: string): Promise<HandoffRecord | null> {
    const row = await this.db
      .selectFrom('run_handoffs')
      .selectAll()
      .where('run_id', '=', runId)
      .executeTakeFirst();
    return row ? toHandoff(row) : null;
  }

  async save(h: HandoffRecord): Promise<void> {
    const row = {
      attempt_n: h.attemptN,
      step_key: h.stepKey,
      items_done: h.itemsDone,
      items_left: h.itemsLeft,
      notes: h.notes.slice(0, 2_000),
      last_error: h.lastError?.slice(0, 1_000) ?? null,
      credits_left: h.creditsLeft,
      active_seconds_left: h.activeSecondsLeft,
      updated_at: h.updatedAt,
    };
    await this.db
      .insertInto('run_handoffs')
      .values({ run_id: h.runId, ...row })
      .onDuplicateKeyUpdate(row)
      .execute();
  }
}

class KyselyMessageRepository implements MessageRepository {
  constructor(private readonly db: Db) {}

  async append(
    messages: readonly {
      id: string;
      runId: string;
      attemptN: number;
      stepKey: string;
      role: string;
      content: unknown;
      createdAt: Date;
    }[],
  ) {
    if (messages.length === 0) return;
    await this.db
      .insertInto('run_messages')
      .values(
        messages.map((m) => ({
          id: m.id,
          run_id: m.runId,
          attempt_n: m.attemptN,
          step_key: m.stepKey,
          role: m.role,
          content: json(m.content),
          created_at: m.createdAt,
        })),
      )
      .execute();
  }
}

class KyselyRunEmailLog implements RunEmailLog {
  constructor(private readonly db: Db) {}

  async claim(
    eventId: string,
    recipient: 'owner' | 'support',
    runId: string,
    at: Date,
  ): Promise<boolean> {
    const result = await this.db
      .insertInto('research_run_emails')
      .ignore()
      .values({ event_id: eventId, recipient, run_id: runId, sent_at: at })
      .executeTakeFirst();
    return Number(result.numInsertedOrUpdatedRows ?? 0) > 0;
  }

  async unclaim(eventId: string, recipient: 'owner' | 'support'): Promise<void> {
    await this.db
      .deleteFrom('research_run_emails')
      .where('event_id', '=', eventId)
      .where('recipient', '=', recipient)
      .execute();
  }
}

/** research's storage in MySQL (PRD section 8). One transaction per `transaction()` call. */
export class KyselyResearchStore implements ResearchStore {
  private readonly outbox: KyselyOutbox;

  constructor(
    private readonly db: Kysely<DB>,
    deps: { ids: IdGenerator; clock: Clock },
  ) {
    this.outbox = new KyselyOutbox(deps.ids, deps.clock);
  }

  transaction<T>(fn: (tx: ResearchTx) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((trx) => fn(this.tx(trx)));
  }

  private tx(trx: Trx): ResearchTx {
    return {
      handle: trx,
      flows: new KyselyFlowRepository(trx),
      runs: new KyselyRunRepository(trx),
      steps: new KyselyStepRepository(trx),
      attempts: new KyselyAttemptRepository(trx),
      handoffs: new KyselyHandoffRepository(trx),
      messages: new KyselyMessageRepository(trx),
      emails: new KyselyRunEmailLog(trx),
      // ResearchEvents mirrors the shared OutboxEvents for research's events (ports.ts).
      outbox: {
        add: (type, payload) => this.outbox.add(trx, type, payload as OutboxEvents[typeof type]),
      },
    };
  }
}

/** Deletes agent transcripts older than 90 days (FR-36); for a scheduled job. */
export async function purgeOldMessages(db: Kysely<DB>, now: Date): Promise<number> {
  const before = new Date(now.getTime() - 90 * 24 * 3600 * 1000);
  const result = await db
    .deleteFrom('run_messages')
    .where('created_at', '<', before)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
