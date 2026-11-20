import { describe, expect, test } from 'vitest';
import { createInMemoryBilling } from '../../billing/index.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import { LOCAL_BUYERS_V1, TOOL_KEYS } from '../domain/local-buyers.js';
import { ResearchRun } from '../domain/run.js';
import { InMemoryResearchStore } from '../infrastructure/in-memory-research-store.js';
import {
  BUSINESS,
  bakeriesPlan,
  owner,
  PLAN,
  researchFixture,
  STAFF_ID,
} from '../test/research-fixture.js';
import { finishRun } from './run-lifecycle.js';

const MINUTE = 60_000;

describe('FR-20: guardrails', () => {
  test('spend reaching 80% during Step 5 skips Steps 6–7; Verify and Score run; budget_reached', async () => {
    const f = await researchFixture();
    f.tools.rates[TOOL_KEYS.firecrawl] = 150_000;
    const started = await f.runs.start(owner(), PLAN);
    expect(await f.runToEnd(started.id)).toEqual(['completed']);
    const steps = new Map(f.store.steps(started.id).map((s) => [s.key, s]));
    expect(steps.get('websites')).toMatchObject({
      status: 'done',
      progress: { stoppedBy: 'collection_stopped' },
    });
    expect(steps.get('socials-reviews')?.status).toBe('skipped');
    expect(steps.get('contacts')?.status).toBe('skipped');
    expect(steps.get('verify')?.status).toBe('done');
    expect(steps.get('score-pitch')?.status).toBe('done');
    expect(f.store.run(started.id)?.toSnapshot()).toMatchObject({
      budgetReached: true,
      status: 'completed',
    });
    expect(f.tools.callsOf(TOOL_KEYS.firecrawl)).toBe(2);
  });

  test('the budget running out in Score & pitch: Leads scored so far are delivered; the run completes', async () => {
    const f = await researchFixture();
    f.tools.failAfter('claude.planning', 2, 'BUDGET_EXCEEDED');
    const started = await f.runs.start(owner(), PLAN);
    expect(await f.runToEnd(started.id)).toEqual(['completed']);
    const run = f.store.run(started.id)?.toSnapshot();
    expect(run).toMatchObject({ status: 'completed', budgetReached: true });
    expect(run?.leadsDelivered).toBeGreaterThan(0);
    expect(run?.leadsDelivered).toBeLessThan(10);
    const steps = new Map(f.store.steps(started.id).map((s) => [s.key, s]));
    expect(steps.get('score-pitch')).toMatchObject({
      status: 'done',
      progress: { stoppedBy: 'budget_exhausted' },
    });
    expect(steps.get('deliver')?.status).toBe('done');
  });

  test('a Step stops when its budget share is used; unused shares carry over', async () => {
    const f = await researchFixture();
    f.tools.rates[TOOL_KEYS.googlePlaces] = 40_000;
    const started = await f.runs.start(owner(), PLAN);
    await f.runToEnd(started.id);
    const maps = f.store.steps(started.id).find((s) => s.key === 'maps-places');
    // Search terms (2%) left most of its share: 32% of 400 = 128 credits for Maps.
    expect(maps?.progress?.stoppedBy).toBe('budget_share');
    expect(f.tools.callsOf(TOOL_KEYS.googlePlaces)).toBe(4);
    expect(f.store.run(started.id)?.status).toBe('completed');
  });

  test('a Step stops at its time limit and the run moves on', async () => {
    const f = await researchFixture();
    f.tools.beforeCall = (req) => {
      if (req.stepKey === 'maps-places') f.advance(4 * MINUTE);
    };
    const started = await f.runs.start(owner(), PLAN);
    await f.runToEnd(started.id);
    const maps = f.store.steps(started.id).find((s) => s.key === 'maps-places');
    expect(maps?.progress?.stoppedBy).toBe('time_limit');
    // 3 calls of 4 minutes use the Step's 12-minute limit.
    expect(f.tools.callsOf(TOOL_KEYS.googlePlaces)).toBe(3);
    expect(f.store.run(started.id)?.status).toBe('completed');
  });

  test('45 active minutes stop collection: Verify, Score and Deliver run with what was found; time_reached', async () => {
    const f = await researchFixture();
    let moved = false;
    f.tools.beforeCall = (req) => {
      if (req.stepKey === 'maps-places' && !moved) {
        moved = true;
        f.advance(46 * MINUTE);
      }
    };
    const started = await f.runs.start(owner(), PLAN);
    expect(await f.runToEnd(started.id)).toEqual(['completed']);
    const steps = new Map(f.store.steps(started.id).map((s) => [s.key, s]));
    expect(steps.get('maps-places')?.progress?.stoppedBy).toBe('collection_stopped');
    for (const key of ['pre-score', 'websites', 'socials-reviews', 'contacts']) {
      expect(steps.get(key)?.status).toBe('skipped');
    }
    for (const key of ['merge', 'verify', 'score-pitch', 'deliver'])
      expect(steps.get(key)?.status).toBe('done');
    const run = f.store.run(started.id)?.toSnapshot();
    expect(run).toMatchObject({ timeReached: true, budgetReached: false });
    expect(run?.leadsDelivered).toBeGreaterThan(0);
  });

  test('the flow’s max active time fails the run with TIME_LIMIT', async () => {
    const f = await researchFixture();
    let moved = false;
    f.tools.beforeCall = (req) => {
      if (req.stepKey === 'verify' && !moved) {
        moved = true;
        f.advance(61 * MINUTE);
      }
    };
    const started = await f.runs.start(owner(), PLAN);
    expect(await f.runToEnd(started.id)).toEqual(['final_error']);
    expect(f.store.run(started.id)?.toSnapshot()).toMatchObject({
      status: 'failed',
      failureCode: 'TIME_LIMIT',
      timeReached: true,
      creditsSpent: 0,
    });
    expect(f.queue.jobs).toEqual([]);
  });

  test('the flow’s max total time (3 h, retries included) fails the run with TIME_LIMIT', async () => {
    const f = await researchFixture();
    const started = await f.runs.start(owner(), PLAN);
    f.tools.fail(TOOL_KEYS.googlePlaces).fail(TOOL_KEYS.mapsScraper).fail(TOOL_KEYS.overpass);
    expect(await f.executor.runAttempt(started.id)).toBe('retryable_error');
    f.advance(3 * 60 * MINUTE);
    expect(await f.executor.runAttempt(started.id)).toBe('final_error');
    expect(f.store.run(started.id)?.toSnapshot().failureCode).toBe('TIME_LIMIT');
  });

  test('thresholds come from the run’s flow-settings snapshot', async () => {
    const f = await researchFixture();
    const flow = await f.flows.get({ ...owner(), roles: ['owner', 'staff'] }, 'local-buyers');
    await f.flows.update(
      { ...owner(), memberId: STAFF_ID, roles: ['owner', 'staff'] },
      'local-buyers',
      {
        key: flow.key,
        name: flow.name,
        runSettings: { ...flow.runSettings, scoreAtBudgetPct: 10 },
        planDefaults: flow.planDefaults,
        steps: flow.steps,
      },
    );
    const started = await f.runs.start(owner(), PLAN);
    await f.runToEnd(started.id);
    const run = f.store.run(started.id)?.toSnapshot();
    expect(run?.flow.runSettings.scoreAtBudgetPct).toBe(10);
    expect(run?.budgetReached).toBe(true);
  });
});

describe('FR-20: Settlement', () => {
  async function settle(
    millicredits: number,
    leads: number,
    outcome: 'completed' | 'failed' | 'cancelled',
  ) {
    const clock = new FixedClock(new Date('2026-11-19T10:00:00.000Z'));
    const ids = new SequentialIdGenerator();
    const billing = createInMemoryBilling({ clock, ids });
    await billing.application.adjustCredits.apply({
      businessId: BUSINESS,
      credits: 1000,
      reason: 'Test',
      memberId: STAFF_ID,
      idempotencyKey: 'k',
    });
    const store = new InMemoryResearchStore();
    const run = ResearchRun.queue({
      id: '00000000-0000-7000-8000-00000000a001',
      flowId: 'flow',
      flow: LOCAL_BUYERS_V1,
      plan: bakeriesPlan(),
      promptVersion: 'v',
      startedByMemberId: 'm',
      startedByStaffId: null,
      now: clock.now(),
    });
    await billing.billingCommands.reserve({ businessId: BUSINESS, runId: run.id, credits: 400 });
    run.beginAttempt(clock.now());
    run.addSpend(millicredits, 0);
    run.setLeadsDelivered(leads);
    await store.transaction((tx) =>
      finishRun(
        tx,
        billing.billingCommands,
        run,
        outcome,
        outcome === 'failed' ? 'PROVIDER_ERROR' : null,
        clock.now(),
      ),
    );
    const wallet = await billing.billingQueries.getWallet(BUSINESS);
    return { run: run.toSnapshot(), wallet, store };
  }

  test('136,200 millicredits settle as 137 credits and release 263 of a 400 Reservation', async () => {
    const { run, wallet } = await settle(136_200, 25, 'completed');
    expect(run.creditsSpent).toBe(137);
    expect(wallet).toMatchObject({ available: 1000 - 137, reserved: 0 });
  });

  test('a failed run with no Leads settles at 0 and releases the full Reservation', async () => {
    const { run, wallet, store } = await settle(50_000, 0, 'failed');
    expect(run.creditsSpent).toBe(0);
    expect(wallet.available).toBe(1000);
    expect(store.outbox[0]).toMatchObject({
      type: 'RunFailed',
      payload: { failureCode: 'PROVIDER_ERROR' },
    });
  });

  test('a failed run that delivered Leads pays its real cost', async () => {
    const { run } = await settle(50_001, 3, 'failed');
    expect(run.creditsSpent).toBe(51);
  });

  test('a cancelled run pays the real cost so far', async () => {
    const { run } = await settle(12_000, 0, 'cancelled');
    expect(run.creditsSpent).toBe(12);
  });
});
