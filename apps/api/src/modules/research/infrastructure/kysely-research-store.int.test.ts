import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { ScriptedLlmClient } from '../../../shared/infrastructure/llm/scripted-llm-client.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { createInMemoryBilling, chargeableCredits } from '../../billing/index.js';
import {
  FlowUseCases,
  ResearchPlanActivity,
  ResearchReportingQueries,
  ResearchRunStats,
} from '../application/flows.js';
import { RunExecutor } from '../application/run-executor.js';
import { RunUseCases } from '../application/runs.js';
import { RunSweeper } from '../application/sweeper.js';
import { LOCAL_BUYERS_V1 } from '../domain/local-buyers.js';
import { seed } from '../index.js';
import { FakeToolRunner } from '../test/fake-tool-runner.js';
import { InMemoryProspectStore } from '../test/in-memory-prospect-store.js';
import {
  BUSINESS,
  ClockSleeper,
  FakeIdentity,
  FakeMonitor,
  FakePlans,
  FakeSettings,
  MemoryStopHook,
  owner,
  PLAN,
  RecordingAudit,
  RecordingQueue,
  staff,
  START,
  STAFF_ID,
} from '../test/research-fixture.js';
import { fakeResearchAgent } from './fake-research-agent.js';
import { KyselyResearchStore } from './kysely-research-store.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const TABLES = [
  'run_messages',
  'run_handoffs',
  'run_attempts',
  'run_steps',
  'research_runs',
  'research_flows',
  'research_run_emails',
  'outbox',
];

beforeEach(async () => {
  await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
  for (const t of TABLES) await sql.raw(`TRUNCATE TABLE ${t}`).execute(db);
  await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);
});

afterAll(async () => {
  await db.destroy();
});

async function mysqlFixture() {
  const clock = new FixedClock(START);
  const ids = new Uuid7Generator();
  const store = new KyselyResearchStore(db, { clock, ids });
  const billing = createInMemoryBilling({ clock, ids });
  await billing.application.adjustCredits.apply({
    businessId: BUSINESS,
    credits: 1000,
    reason: 't',
    memberId: STAFF_ID,
    idempotencyKey: 'k',
  });
  const llm = new ScriptedLlmClient(fakeResearchAgent);
  const tools = new FakeToolRunner(clock, llm);
  const prospects = new InMemoryProspectStore();
  const analytics = new RecordingAnalyticsTracker();
  const queue = new RecordingQueue();
  const monitor = new FakeMonitor();
  const settings = new FakeSettings();
  const audit = new RecordingAudit();
  const stopHook = new MemoryStopHook();
  const flows = new FlowUseCases({ store, settings, audit, clock, ids });
  await flows.ensureTemplate(LOCAL_BUYERS_V1, true);
  const runs = new RunUseCases({
    store,
    billing: billing.billingCommands,
    plans: new FakePlans(),
    catalog: tools,
    identity: new FakeIdentity(),
    toolCalls: tools,
    monitor,
    audit,
    clock,
    ids,
    analytics,
  });
  const executor = new RunExecutor({
    store,
    tools,
    catalog: tools,
    prospects,
    billing: billing.billingCommands,
    clock,
    ids,
    sleeper: new ClockSleeper(clock),
    analytics,
    queue,
    workerId: 'worker-int',
    stopHook,
  });
  const sweeper = new RunSweeper({
    store,
    billing: billing.billingCommands,
    queue,
    monitor,
    clock,
    analytics,
  });
  return {
    clock,
    ids,
    store,
    billing,
    tools,
    prospects,
    llm,
    queue,
    flows,
    runs,
    executor,
    sweeper,
    stopHook,
    settings,
  };
}

describe('KyselyResearchStore (MySQL)', () => {
  test('FR-19: a full run persists steps, attempts, handoff, messages and the outbox', async () => {
    const f = await mysqlFixture();
    const run = await f.runs.start(owner(), PLAN);
    expect(await f.executor.runAttempt(run.id)).toBe('completed');

    const row = await db
      .selectFrom('research_runs')
      .selectAll()
      .where('id', '=', run.id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      status: 'completed',
      attempts: 1,
      leads_delivered: 10,
      prompt_version: 'research.v1',
    });
    expect(row.credits_spent).toBe(
      chargeableCredits({
        millicreditsSpent: Number(row.millicredits_spent),
        outcome: 'completed',
        leadsDelivered: 10,
      }),
    );
    const steps = await db
      .selectFrom('run_steps')
      .select(['step_key', 'status'])
      .where('run_id', '=', run.id)
      .orderBy('position')
      .execute();
    expect(steps.every((s) => s.status === 'done')).toBe(true);
    const attempt = await db
      .selectFrom('run_attempts')
      .selectAll()
      .where('run_id', '=', run.id)
      .executeTakeFirstOrThrow();
    expect(attempt).toMatchObject({
      n: 1,
      status: 'completed',
      lease_owner: 'worker-int',
      reached_step: 'deliver',
    });
    expect(
      await db
        .selectFrom('run_handoffs')
        .selectAll()
        .where('run_id', '=', run.id)
        .executeTakeFirst(),
    ).toMatchObject({ attempt_n: 1 });
    const messages = await db
      .selectFrom('run_messages')
      .select('role')
      .where('run_id', '=', run.id)
      .execute();
    expect(messages.length).toBeGreaterThan(20);
    const outbox = await db.selectFrom('outbox').select('type').orderBy('id').execute();
    expect(outbox.map((o) => o.type)).toEqual(['RunRequested', 'RunCompleted']);

    // Reads round-trip through the mappers.
    const summary = await f.runs.get(owner(), run.id);
    expect(summary).toMatchObject({
      status: 'completed',
      leadsDelivered: 10,
      flow: { key: 'local-buyers', version: 1 },
    });
    expect((await f.runs.getForStaff(staff(), run.id)).attempts).toHaveLength(1);
  });

  test('FR-36 / AJ-9: a stopped worker, the sweeper and attempt 2 from the handoff, on MySQL', async () => {
    const f = await mysqlFixture();
    const run = await f.runs.start(owner(), PLAN);
    await f.stopHook.set({ stepKey: 'websites', items: 12 });
    expect(await f.executor.runAttempt(run.id)).toBe('stopped');
    f.clock.set(new Date(f.clock.now().getTime() + 3 * 60_000));
    expect((await f.sweeper.sweep()).stalled).toBe(1);
    const attempts = await f.store.transaction((tx) => tx.attempts.list(run.id));
    expect(attempts[0]).toMatchObject({
      status: 'worker_stopped',
      reachedStep: 'websites',
      reachedItem: 12,
    });
    expect(attempts[0]?.handoff?.itemsDone).toBe(12);

    const retry = (await f.store.transaction((tx) => tx.runs.find(run.id)))?.toSnapshot();
    expect(retry?.status).toBe('retrying');
    f.clock.set(retry?.nextAttemptAt ?? f.clock.now());
    expect(await f.executor.runAttempt(run.id)).toBe('completed');
    expect(f.tools.callsOf('firecrawl.scrape')).toBe(25);
  });

  test('leases: renewal only by the owner of a running attempt; expired leases are found', async () => {
    const f = await mysqlFixture();
    const run = await f.runs.start(owner(), PLAN);
    await f.stopHook.set({ stepKey: 'search-terms', items: 1 });
    await f.executor.runAttempt(run.id);
    const until = new Date(START.getTime() + 60_000);
    expect(
      await f.store.transaction((tx) => tx.attempts.renewLease(run.id, 1, 'worker-int', until)),
    ).toBe(true);
    expect(
      await f.store.transaction((tx) => tx.attempts.renewLease(run.id, 1, 'worker-int', until)),
    ).toBe(true);
    expect(
      await f.store.transaction((tx) => tx.attempts.renewLease(run.id, 1, 'other', until)),
    ).toBe(false);
    expect(
      await f.store.transaction((tx) =>
        tx.attempts.expiredLeases(new Date(START.getTime() + 61_000), 10),
      ),
    ).toHaveLength(1);
    expect(await f.store.transaction((tx) => tx.attempts.expiredLeases(START, 10))).toHaveLength(0);
  });

  test('FR-37: flow versions; runs keep theirs; plans using; typical credits and last runs', async () => {
    const f = await mysqlFixture();
    const first = await f.runs.start(owner(), PLAN);
    const { version: _v, ...rest } = LOCAL_BUYERS_V1;
    await f.flows.update(staff(), 'local-buyers', {
      ...rest,
      runSettings: { ...rest.runSettings, maxAttempts: 2 },
    } as never);
    expect((await f.flows.get(staff(), 'local-buyers')).version).toBe(2);
    expect((await f.flows.list(staff())).items).toEqual([
      expect.objectContaining({ version: 2, plansUsing: 1, isDefault: true }),
    ]);
    expect(await f.runs.get(owner(), first.id)).toMatchObject({
      flow: { version: 1 },
      attempt: { max: 3 },
    });

    await f.executor.runAttempt(first.id);
    expect(await new ResearchRunStats(f.store).typicalCredits('local-buyers')).toBeNull();
    const last = await new ResearchPlanActivity(f.store).lastRuns(BUSINESS, [PLAN]);
    expect(last.get(PLAN)?.id).toBe(first.id);
    f.clock.set(new Date(START.getTime() + 1000));
    const second = await f.runs.start(owner(), PLAN);
    expect((await new ResearchPlanActivity(f.store).lastRuns(BUSINESS, [PLAN])).get(PLAN)?.id).toBe(
      second.id,
    );
    const page = await f.runs.listForPlan(owner(), PLAN, { limit: 1 });
    expect(page.items[0]?.id).toBe(second.id);
    const next = await f.runs.listForPlan(owner(), PLAN, {
      limit: 1,
      cursor: page.nextCursor ?? '',
    });
    expect(next).toMatchObject({ items: [{ id: first.id }], nextCursor: null });
    expect(
      (await f.runs.listForStaff(staff(), { limit: 10, status: 'completed' })).items.map(
        (r) => r.id,
      ),
    ).toEqual([first.id]);
  });

  test('FR-30/FR-31: reporting reads run facts in a window and run counts per Business', async () => {
    const f = await mysqlFixture();
    const first = await f.runs.start(owner(), PLAN);
    await f.executor.runAttempt(first.id);
    f.clock.set(new Date(START.getTime() + 60_000));
    const second = await f.runs.start(owner(), PLAN);
    const q = new ResearchReportingQueries(f.store);
    const done = (await f.store.transaction((tx) => tx.runs.find(first.id)))?.toSnapshot();

    const facts = await q.runFacts({ from: START, to: new Date(START.getTime() + 120_000) });
    expect([...facts].sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime())).toEqual([
      {
        runId: first.id,
        businessId: BUSINESS,
        status: 'completed',
        queuedAt: START,
        startedAt: done?.startedAt,
        finishedAt: done?.finishedAt,
        creditsSpent: done?.creditsSpent,
        maxCredits: done?.plan.guardrails.maxCredits,
        providerCostMicros: done?.providerCostMicros,
        leadsDelivered: done?.leadsDelivered,
        icpEdited: done?.plan.icpEdited,
        failureCode: null,
      },
      expect.objectContaining({ runId: second.id, status: 'queued', creditsSpent: 0 }),
    ]);
    expect(done?.leadsDelivered).toBeGreaterThan(0);
    // [from, to): a run queued at `to` is left out, one queued at `from` is in.
    expect(
      (await q.runFacts({ from: START, to: new Date(START.getTime() + 60_000) })).map(
        (r) => r.runId,
      ),
    ).toEqual([first.id]);
    expect(await q.runCounts([BUSINESS, 'f0000000-0000-4000-8000-00000000dead'])).toEqual(
      new Map([[BUSINESS, 2]]),
    );
    expect(await q.runCounts([])).toEqual(new Map());
  });

  test('FR-22: an email claim succeeds once per event and recipient', async () => {
    const f = await mysqlFixture();
    const run = await f.runs.start(owner(), PLAN);
    const claim = () =>
      f.store.transaction((tx) => tx.emails.claim('evt-1', 'owner', run.id, START));
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);
    await f.store.transaction((tx) => tx.emails.unclaim('evt-1', 'owner'));
    expect(await claim()).toBe(true);
  });

  test('a failing transaction rolls everything back', async () => {
    const f = await mysqlFixture();
    const run = await f.runs.start(owner(), PLAN);
    await expect(
      f.store.transaction(async (tx) => {
        const r = await tx.runs.findForUpdate(run.id);
        r?.beginAttempt(START);
        if (r) await tx.runs.save(r);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await f.store.transaction((tx) => tx.runs.find(run.id)))?.status).toBe('queued');
  });

  test('section 8a: the seed writes "Local buyers" v1 and the completed demo run, idempotently', async () => {
    const demo = {
      businesses: { sweetSupply: BUSINESS },
      members: { owner: '00000000-0000-7000-8000-00000000d101' },
      products: { caneSugar: '00000000-0000-7000-8000-00000000d201' },
      plans: { bakeriesNearAustin: PLAN },
      runs: { bakeriesNearAustin: '00000000-0000-7000-8000-00000000d401' },
    };
    await seed({ db, demo });
    await seed({ db, demo });
    const flows = await db.selectFrom('research_flows').selectAll().execute();
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({
      key: 'local-buyers',
      version: 1,
      is_default: 1,
      is_template: 1,
    });
    const runs = await db.selectFrom('research_runs').selectAll().execute();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: 'completed',
      leads_delivered: 25,
      credits_spent: 137,
      millicredits_spent: 136_200,
      plan_id: PLAN,
    });
    expect(await db.selectFrom('outbox').selectAll().execute()).toEqual([]);
  });
});
