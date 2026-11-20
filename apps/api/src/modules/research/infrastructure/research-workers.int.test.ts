import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { sql } from 'kysely';
import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { InMemoryEmailSender } from '../../../shared/infrastructure/email/in-memory-email-sender.js';
import { ScriptedLlmClient } from '../../../shared/infrastructure/llm/scripted-llm-client.js';
import { SystemClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { createInMemoryBilling } from '../../billing/index.js';
import { FlowUseCases } from '../application/flows.js';
import { RunUseCases } from '../application/runs.js';
import { LOCAL_BUYERS_V1 } from '../domain/local-buyers.js';
import { registerResearchWorkers, researchSubscriptions } from '../index.js';
import { FakeToolRunner } from '../test/fake-tool-runner.js';
import { InMemoryProspectStore } from '../test/in-memory-prospect-store.js';
import {
  BUSINESS,
  FakeIdentity,
  FakeMonitor,
  FakePlans,
  FakeSettings,
  owner,
  PLAN,
  RecordingAudit,
  STAFF_ID,
} from '../test/research-fixture.js';
import {
  BullRunQueue,
  RedisQueueMonitor,
  RedisStopHook,
  RESEARCH_EMAILS_QUEUE,
  RESEARCH_RUNS_QUEUE,
} from './bullmq.js';
import { fakeResearchAgent } from './fake-research-agent.js';
import { KyselyResearchStore } from './kysely-research-store.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const closers: { close(): Promise<void> }[] = [];
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
  for (const c of closers.reverse()) await c.close();
  await db.destroy();
  connection.disconnect();
});

const instant = { sleep: () => Promise.resolve() };
const noHeartbeat = { start: () => () => undefined };

async function setup(options: { sweepEveryMs?: number } = {}) {
  const prefix = `test-${randomUUID()}`;
  const clock = new SystemClock();
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
  const tools = new FakeToolRunner(clock, new ScriptedLlmClient(fakeResearchAgent));
  const email = new InMemoryEmailSender();
  const settings = new FakeSettings();
  const analytics = new RecordingAnalyticsTracker();
  const collaborators = {
    clock,
    ids,
    analytics,
    billing: billing.billingCommands,
    plans: new FakePlans(),
    tools,
    catalog: tools,
    toolCalls: tools,
    prospects: new InMemoryProspectStore(),
    identity: new FakeIdentity(),
    settings,
    audit: new RecordingAudit(),
    email,
    appUrl: 'http://localhost:5173',
  };
  await new FlowUseCases({
    store,
    settings,
    audit: collaborators.audit,
    clock,
    ids,
  }).ensureTemplate(LOCAL_BUYERS_V1, true);
  const workers = registerResearchWorkers({
    db,
    connection,
    logger: pino({ level: 'silent' }),
    prefix,
    research: {
      ...collaborators,
      workerId: 'worker-int',
      sleeper: instant,
      heartbeat: noHeartbeat,
      testHooks: true,
      ...(options.sweepEveryMs ? { sweepEveryMs: options.sweepEveryMs } : {}),
    },
  });
  closers.push(...workers);
  const runs = new RunUseCases({ ...collaborators, store, monitor: new FakeMonitor() });
  const runsQueue = new Queue(RESEARCH_RUNS_QUEUE, { connection, prefix });
  const emailsQueue = new Queue(RESEARCH_EMAILS_QUEUE, { connection, prefix });
  const runEvents = new QueueEvents(RESEARCH_RUNS_QUEUE, { connection, prefix });
  const emailEvents = new QueueEvents(RESEARCH_EMAILS_QUEUE, { connection, prefix });
  closers.push(runsQueue, emailsQueue, runEvents, emailEvents);
  await Promise.all([runEvents.waitUntilReady(), emailEvents.waitUntilReady()]);
  return { prefix, store, runs, runsQueue, emailsQueue, runEvents, emailEvents, email, tools };
}

async function until(check: () => Promise<boolean>, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out');
}

describe('research workers on BullMQ (Valkey)', () => {
  test('subscriptions: RunRequested → research-runs; RunCompleted and RunFailed → research-emails', () => {
    expect(researchSubscriptions).toEqual([
      { event: 'RunRequested', queue: 'research-runs' },
      { event: 'RunCompleted', queue: 'research-emails' },
      { event: 'RunFailed', queue: 'research-emails' },
    ]);
  });

  test('FR-18/FR-19: a RunRequested job runs the flow to completion; the completion email is sent once', async () => {
    const s = await setup();
    const run = await s.runs.start(owner(), PLAN);
    const job = await s.runsQueue.add('RunRequested', {
      eventId: 'evt-run',
      type: 'RunRequested',
      payload: { runId: run.id, businessId: BUSINESS },
      occurredAt: new Date().toISOString(),
    });
    expect(await job.waitUntilFinished(s.runEvents, 30_000)).toBe('completed');
    const done = await s.store.transaction((tx) => tx.runs.find(run.id));
    expect(done?.toSnapshot()).toMatchObject({ status: 'completed', leadsDelivered: 10 });

    const message = {
      eventId: 'evt-done',
      type: 'RunCompleted',
      payload: { runId: run.id, businessId: BUSINESS, planId: PLAN, startedByStaffId: null },
      occurredAt: new Date().toISOString(),
    };
    for (const jobId of ['a', 'b']) {
      const emailJob = await s.emailsQueue.add('RunCompleted', message, { jobId });
      await emailJob.waitUntilFinished(s.emailEvents, 10_000);
    }
    expect(s.email.sent.map((m) => m.subject)).toEqual([
      'Your leads are ready: Bakeries near Austin',
    ]);
  }, 40_000);

  test('FR-36: the sweeper (scheduled) ends an expired attempt and the next attempt completes the run', async () => {
    const s = await setup({ sweepEveryMs: 300 });
    const run = await s.runs.start(owner(), PLAN);
    // The run is stuck: attempt 1 holds an expired lease and the retry wait is 0.
    await s.store.transaction(async (tx) => {
      const r = await tx.runs.findForUpdate(run.id);
      if (!r) throw new Error('no run');
      r.beginAttempt(new Date(Date.now() - 10 * 60_000));
      await tx.runs.save(r);
      await tx.attempts.insert({
        id: randomUUID(),
        runId: run.id,
        n: 1,
        status: 'running',
        fromStep: 'search-terms',
        fromItem: 0,
        reachedStep: null,
        reachedItem: null,
        error: null,
        handoff: null,
        leaseOwner: 'dead-worker',
        leaseExpiresAt: new Date(Date.now() - 60_000),
        startedAt: new Date(Date.now() - 10 * 60_000),
        endedAt: null,
        activeSeconds: 0,
      });
      // Settings snapshot with no wait, so the test doesn't wait a minute.
      await sql`UPDATE research_runs SET flow_settings = JSON_SET(flow_settings, '$.runSettings.retryWaitsMinutes', JSON_ARRAY(0)) WHERE id = ${run.id}`.execute(
        tx.handle as never,
      );
    });
    await until(
      async () => (await s.store.transaction((tx) => tx.runs.find(run.id)))?.status === 'completed',
      30_000,
    );
    const attempts = await s.store.transaction((tx) => tx.attempts.list(run.id));
    expect(attempts.map((a) => a.status)).toEqual(['worker_stopped', 'completed']);
    const monitor = new RedisQueueMonitor({ connection, prefix: s.prefix });
    closers.push(monitor);
    expect((await monitor.sweeperStatus()).stalledFound).toBeGreaterThanOrEqual(1);
    expect((await monitor.sweeperStatus()).lastRunAt).not.toBeNull();
  }, 40_000);

  test('the run queue de-duplicates attempt jobs; the stop hook is taken once', async () => {
    const prefix = `test-${randomUUID()}`;
    const queue = new BullRunQueue({ connection, prefix });
    const monitor = new RedisQueueMonitor({ connection, prefix });
    closers.push(queue, monitor);
    await queue.enqueue('run-x', { attemptN: 2, delayMs: 60_000 });
    await queue.enqueue('run-x', { attemptN: 2, delayMs: 60_000 });
    expect(await monitor.counts()).toMatchObject({ delayed: 1, waiting: 0 });

    const hook = new RedisStopHook({ connection, prefix });
    await hook.set({ stepKey: 'websites', items: 12 });
    expect(await hook.take()).toEqual({ stepKey: 'websites', items: 12 });
    expect(await hook.take()).toBeNull();
  });
});
