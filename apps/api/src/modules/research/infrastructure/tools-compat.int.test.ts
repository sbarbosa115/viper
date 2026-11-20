import type { Transaction } from 'kysely';
import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import type { DB } from '../../../shared/infrastructure/db/schema.js';
import { ScriptedLlmClient } from '../../../shared/infrastructure/llm/scripted-llm-client.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { createInMemoryBilling } from '../../billing/index.js';
import { createTools, seed as seedTools } from '../../tools/index.js';
import { FlowUseCases } from '../application/flows.js';
import type { ToolCallLogPort, ToolCatalogPort, ToolRunnerPort } from '../application/ports.js';
import { RunExecutor } from '../application/run-executor.js';
import { RunUseCases } from '../application/runs.js';
import { LOCAL_BUYERS_V1 } from '../domain/local-buyers.js';
import { InMemoryProspectStore } from '../test/in-memory-prospect-store.js';
import {
  BUSINESS,
  ClockSleeper,
  FakeIdentity,
  FakeMonitor,
  FakePlans,
  FakeSettings,
  owner,
  PLAN,
  RecordingAudit,
  RecordingQueue,
  START,
  STAFF_ID,
} from '../test/research-fixture.js';
import { fakeResearchAgent } from './fake-research-agent.js';
import { KyselyResearchStore } from './kysely-research-store.js';

/**
 * research against the real tools module in fake mode (its ToolRunner, catalog, Claude adapter and
 * fixture adapters on MySQL): the inputs research sends pass the tools' schemas, and their
 * outputs feed the Steps through to Leads.
 */
const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const TABLES = [
  'tool_calls',
  'tools',
  'run_messages',
  'run_handoffs',
  'run_attempts',
  'run_steps',
  'research_runs',
  'research_flows',
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

const toolsSettings = {
  ai: () =>
    Promise.resolve({
      anthropicApiKey: 'fake',
      planningModel: 'claude-planning',
      chatModel: 'claude-chat',
      fastModel: 'claude-fast',
    }),
  provider: (key: string) =>
    Promise.resolve(
      (key === 'twilio'
        ? { accountSid: 'AC-fake', authToken: 'fake' }
        : { apiKey: 'fake' }) as never,
    ),
};

describe('research with the tools module in fake mode (MySQL)', () => {
  test('FR-19: a full run through the real ToolRunner delivers Leads; every call is metered', async () => {
    const clock = new FixedClock(START);
    const ids = new Uuid7Generator();
    await seedTools({ db, clock });
    const instant = { sleep: () => Promise.resolve() };
    const tools = createTools({
      db,
      clock,
      ids,
      settings: toolsSettings,
      mode: 'fake',
      llm: new ScriptedLlmClient(fakeResearchAgent),
      audit: { record: () => Promise.resolve() },
      sleeper: instant,
    });
    const runner: ToolRunnerPort = {
      call: (req) =>
        tools.toolRunner.call({ ...req, within: req.within as Transaction<DB> | undefined }),
    };
    const catalog: ToolCatalogPort = {
      availability: async (keys) =>
        new Map(
          (await tools.toolQueries.availability(keys)).map((a) => [
            a.key,
            a.enabled && a.configured,
          ]),
        ),
    };
    const toolCalls: ToolCallLogPort = {
      listForRun: async (runId) =>
        (await tools.toolQueries.callsForRun(runId)).map((c) => ({ ...c, attemptN: c.attempt })),
    };

    const store = new KyselyResearchStore(db, { clock, ids });
    const billing = createInMemoryBilling({ clock, ids });
    await billing.application.adjustCredits.apply({
      businessId: BUSINESS,
      credits: 1000,
      reason: 't',
      memberId: STAFF_ID,
      idempotencyKey: 'k',
    });
    const settings = new FakeSettings();
    const audit = new RecordingAudit();
    const analytics = new RecordingAnalyticsTracker();
    await new FlowUseCases({ store, settings, audit, clock, ids }).ensureTemplate(
      LOCAL_BUYERS_V1,
      true,
    );
    const runs = new RunUseCases({
      store,
      billing: billing.billingCommands,
      plans: new FakePlans(),
      catalog,
      identity: new FakeIdentity(),
      toolCalls,
      monitor: new FakeMonitor(),
      audit,
      clock,
      ids,
      analytics,
    });
    const prospects = new InMemoryProspectStore();
    const executor = new RunExecutor({
      store,
      tools: runner,
      catalog,
      prospects,
      billing: billing.billingCommands,
      clock,
      ids,
      sleeper: new ClockSleeper(clock),
      analytics,
      queue: new RecordingQueue(),
      workerId: 'compat',
      // The tools module's ToolRunner already retries provider errors (1 s, 4 s, 16 s).
      retryDelaysMs: [],
    });

    const run = await runs.start(owner(), PLAN);
    const outcome = await executor.runAttempt(run.id);
    const attempts = await store.transaction((tx) => tx.attempts.list(run.id));
    expect(outcome, attempts[0]?.error ?? '').toBe('completed');

    const done = (await store.transaction((tx) => tx.runs.find(run.id)))?.toSnapshot();
    expect(done?.status).toBe('completed');
    expect(done?.leadsDelivered).toBeGreaterThan(0);
    const steps = await store.transaction((tx) => tx.steps.list(run.id));
    expect(steps.filter((s) => s.status !== 'done').map((s) => s.key)).toEqual([]);
    for (const key of ['maps-places', 'websites', 'verify']) {
      expect(steps.find((s) => s.key === key)?.progress?.okCalls, key).toBeGreaterThan(0);
    }

    const calls = await toolCalls.listForRun(run.id);
    expect(calls.filter((c) => c.status !== 'ok')).toEqual([]);
    const total = calls.reduce((sum, c) => sum + c.millicredits, 0);
    expect(done?.millicreditsSpent).toBe(total);
    // Within the 400-credit budget at the seeded Rate card.
    expect(done?.creditsSpent).toBeLessThanOrEqual(400);
    expect(calls.some((c) => c.toolKey === 'claude.fast')).toBe(true);
    expect(calls.some((c) => c.toolKey === 'claude.planning')).toBe(true);
  }, 60_000);
});
