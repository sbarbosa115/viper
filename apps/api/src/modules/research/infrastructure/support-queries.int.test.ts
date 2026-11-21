import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { FlowUseCases } from '../application/flows.js';
import { PROMPT_VERSION } from '../application/prompts/v1.js';
import { LOCAL_BUYERS_KEY, LOCAL_BUYERS_V1 } from '../domain/local-buyers.js';
import { ResearchRun } from '../domain/run.js';
import { createResearchSupportQueries, seed } from '../index.js';
import {
  BUSINESS,
  FakeSettings,
  OTHER_BUSINESS,
  OWNER_ID,
  PLAN,
  RecordingAudit,
  UNKNOWN_ID,
  bakeriesPlan,
} from '../test/research-fixture.js';
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
const NOW = new Date('2026-11-21T12:00:00.000Z');
const DAY = 24 * 3600 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

beforeEach(async () => {
  await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
  for (const t of TABLES) await sql.raw(`TRUNCATE TABLE ${t}`).execute(db);
  await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);
});

afterAll(async () => {
  await db.destroy();
});

async function fixture() {
  const clock = new FixedClock(NOW);
  const ids = new Uuid7Generator();
  const store = new KyselyResearchStore(db, { clock, ids });
  await new FlowUseCases({
    store,
    settings: new FakeSettings(),
    audit: new RecordingAudit(),
    clock,
    ids,
  }).ensureTemplate(LOCAL_BUYERS_V1, true);
  const queries = createResearchSupportQueries({ db, clock, ids });

  async function addRun(
    at: Date,
    options: {
      businessId?: string;
      start?: boolean;
      finish?: (run: ResearchRun, steps: Map<string, string>) => void;
      failedStep?: string;
    } = {},
  ): Promise<string> {
    const businessId = options.businessId ?? BUSINESS;
    const id = ids.next();
    await store.transaction(async (tx) => {
      const flow = await tx.flows.latest(LOCAL_BUYERS_KEY);
      if (!flow) throw new Error('no flow');
      const plan = { ...bakeriesPlan(), id: PLAN, businessId } as never;
      const run = ResearchRun.queue({
        id,
        flowId: flow.id,
        flow: {
          key: flow.key,
          name: flow.name,
          version: flow.version,
          runSettings: flow.runSettings,
          planDefaults: flow.planDefaults,
          steps: flow.steps,
        },
        plan,
        promptVersion: PROMPT_VERSION,
        startedByMemberId: OWNER_ID,
        startedByStaffId: null,
        now: at,
      });
      if (options.start !== false) run.beginAttempt(at);
      options.finish?.(run, new Map());
      await tx.runs.insert(run);
      if (options.failedStep) {
        const failedAt = flow.steps.findIndex((d) => d.key === options.failedStep);
        await tx.steps.insertMany(
          flow.steps.map((d, position) => ({
            id: ids.next(),
            runId: id,
            key: d.key,
            position,
            status: position < failedAt ? 'done' : position === failedAt ? 'failed' : 'pending',
            attempts: 1,
            progress: null,
            startedAt: null,
            finishedAt: null,
            millicreditsSpent: 0,
            checkpoint: null,
            error: position === failedAt ? 'Provider down' : null,
          })),
        );
      }
    });
    return id;
  }
  return { addRun, queries, store, clock, ids };
}

describe('prd-support FR-3: research reads for support', () => {
  test('recentRunsForBusiness scopes to the Business, newest first, with limit', async () => {
    const f = await fixture();
    const oldest = await f.addRun(ago(5));
    const newest = await f.addRun(ago(1));
    const middle = await f.addRun(ago(3));
    await f.addRun(ago(2), { businessId: OTHER_BUSINESS });

    const all = await f.queries.recentRunsForBusiness(BUSINESS, ago(90), 10);
    expect(all.map((r) => r.id)).toEqual([newest, middle, oldest]);
    expect(all[0]).toMatchObject({
      planId: PLAN,
      planName: expect.any(String),
      status: 'running',
      stoppedStep: null,
      creditsCharged: 0,
    });
    const limited = await f.queries.recentRunsForBusiness(BUSINESS, ago(90), 2);
    expect(limited.map((r) => r.id)).toEqual([newest, middle]);
  });

  test('the window includes a run started exactly at `since` and leaves older ones out', async () => {
    const f = await fixture();
    const edge = await f.addRun(ago(90));
    await f.addRun(new Date(ago(90).getTime() - 1));
    const runs = await f.queries.recentRunsForBusiness(BUSINESS, ago(90), 10);
    expect(runs.map((r) => r.id)).toEqual([edge]);
  });

  test('a queued run reads as running; its startedAt is when it was queued', async () => {
    const f = await fixture();
    const id = await f.addRun(ago(1), { start: false });
    const [run] = await f.queries.recentRunsForBusiness(BUSINESS, ago(90), 5);
    expect(run).toMatchObject({ id, status: 'running', startedAt: ago(1).toISOString() });
  });

  test('a failed run reports the step it stopped in and the credits charged after the waiver', async () => {
    const f = await fixture();
    const id = await f.addRun(ago(2), {
      failedStep: 'websites',
      finish: (run) => {
        run.addSpend(20_000, 1);
        run.waiveSpend();
        run.fail('PROVIDER_ERROR', ago(2), 0);
      },
    });
    const [ref] = await f.queries.recentRunsForBusiness(BUSINESS, ago(90), 5);
    expect(ref).toMatchObject({
      id,
      status: 'failed',
      stoppedStep: { number: 5, name: 'Websites' },
      creditsCharged: 0,
    });
    const detail = await f.queries.runForSupport(id);
    expect(detail).toMatchObject({
      id,
      businessId: BUSINESS,
      attempt: 1,
      lastError: 'Provider down',
      stoppedStep: { number: 5, name: 'Websites' },
    });
  });

  test('a completed run has no stopped step and shows its charged credits', async () => {
    const f = await fixture();
    const id = await f.addRun(ago(2), { finish: (run) => run.complete(ago(2), 137) });
    expect(await f.queries.runForSupport(id)).toMatchObject({
      status: 'completed',
      stoppedStep: null,
      creditsCharged: 137,
      lastError: null,
    });
  });

  test('runForSupport is null for an unknown run', async () => {
    const f = await fixture();
    expect(await f.queries.runForSupport(UNKNOWN_ID)).toBeNull();
  });

  test('section 8a: the seeded failed run stopped at Websites with 0 credits charged', async () => {
    const f = await fixture();
    const demo = {
      businesses: { sweetSupply: BUSINESS },
      members: { owner: OWNER_ID },
      products: { caneSugar: '00000000-0000-7000-8000-00000000d201' },
      plans: { bakeriesNearAustin: PLAN },
      runs: { bakeriesNearAustin: '00000000-0000-7000-8000-00000000d401' },
    };
    await seed({ db, clock: f.clock, demo });
    await seed({ db, clock: f.clock, demo });
    const runs = await f.queries.recentRunsForBusiness(BUSINESS, ago(90), 10);
    const failed = runs.filter((r) => r.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      planId: PLAN,
      planName: 'Bakeries near Austin',
      stoppedStep: { number: 5, name: 'Websites' },
      creditsCharged: 0,
    });
  });
});
