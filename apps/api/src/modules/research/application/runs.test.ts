import { insufficientCreditsError } from '@app/contracts/errors';
import { runSummary, staffRunDetail, staffRunSummary } from '@app/contracts/research';
import { describe, expect, test } from 'vitest';
import { CodedError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import { TOOL_KEYS } from '../domain/local-buyers.js';
import type { ResearchTx } from './ports.js';
import {
  actingAs,
  bakeriesPlan,
  BUSINESS,
  OTHER_BUSINESS,
  owner,
  PLAN,
  researchFixture,
  staff,
  STAFF_ID,
  UNKNOWN_ID,
} from '../test/research-fixture.js';

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof CodedError) return error.code;
    if (error instanceof NotFoundError || error instanceof ForbiddenError) return error.code;
    throw error;
  }
  throw new Error('expected an error');
}

const SECOND_PLAN = '00000000-0000-7000-8000-00000000e002';

describe('FR-18: start a Research run', () => {
  test('a valid start reserves max credits, queues the run and writes RunRequested', async () => {
    const f = await researchFixture();
    const run = runSummary.parse(await f.runs.start(owner(), PLAN));
    expect(run).toMatchObject({
      status: 'queued',
      creditsReserved: 400,
      flow: { key: 'local-buyers', version: 1 },
      attempt: { current: 0, max: 3 },
      takingLonger: false,
      startedAt: null,
    });
    expect(run.steps.map((s) => s.status)).toEqual(Array(10).fill('pending'));
    expect(await f.billing.billingQueries.getWallet(BUSINESS)).toMatchObject({
      reserved: 400,
      available: 600,
    });
    expect(f.store.outbox).toEqual([
      { type: 'RunRequested', payload: { runId: run.id, businessId: BUSINESS } },
    ]);
    const snapshot = f.store.run(run.id)?.toSnapshot();
    expect(snapshot).toMatchObject({
      promptVersion: 'research.v1',
      startedByStaffId: null,
      plan: { name: 'Bakeries near Austin' },
    });
    expect(f.analytics.events).toContainEqual(
      expect.objectContaining({
        name: 'run_started',
        properties: {
          business_id: BUSINESS,
          plan_id: PLAN,
          run_id: run.id,
          credits_reserved: 400,
          started_by_staff: false,
        },
      }),
    );
  });

  test('402 INSUFFICIENT_CREDITS with { available, required } when credits are short', async () => {
    const f = await researchFixture({ credits: 300 });
    const error = await f.runs.start(owner(), PLAN).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CodedError);
    const e = error as CodedError;
    expect(
      insufficientCreditsError.parse({
        error: { code: e.code, message: e.message, details: e.details },
      }).error.details,
    ).toEqual({
      available: 300,
      required: 400,
    });
    expect(f.store.outbox).toEqual([]);
  });

  test('403 EMAIL_NOT_VERIFIED, 404 for another Business’s Plan, 409 RUN_IN_PROGRESS, 503 RESEARCH_UNAVAILABLE', async () => {
    const f = await researchFixture();
    expect(await codeOf(f.runs.start(owner({ emailVerified: false }), PLAN))).toBe(
      'EMAIL_NOT_VERIFIED',
    );
    expect(await codeOf(f.runs.start(owner({ businessId: OTHER_BUSINESS }), PLAN))).toBe(
      'NOT_FOUND',
    );
    expect(await codeOf(f.runs.start(owner(), UNKNOWN_ID))).toBe('NOT_FOUND');

    for (const t of [TOOL_KEYS.googlePlaces, TOOL_KEYS.mapsScraper, TOOL_KEYS.overpass])
      f.tools.disabled.add(t);
    expect(await codeOf(f.runs.start(owner(), PLAN))).toBe('RESEARCH_UNAVAILABLE');
    f.tools.disabled.clear();
    // An optional Step's Tool being off doesn't block a start.
    f.tools.disabled.add(TOOL_KEYS.yelp);
    await f.runs.start(owner(), PLAN);
    f.plans.plans.set(SECOND_PLAN, bakeriesPlan({ id: SECOND_PLAN }));
    expect(await codeOf(f.runs.start(owner(), SECOND_PLAN))).toBe('RUN_IN_PROGRESS');
  });

  test('Staff Acting as: the run is charged to the Business and marked started by Staff', async () => {
    const f = await researchFixture();
    const run = await f.runs.start(actingAs(), PLAN);
    expect(f.store.run(run.id)?.toSnapshot().startedByStaffId).toBe(STAFF_ID);
    expect(
      f.analytics.events.find((e) => e.name === 'run_started')?.properties?.started_by_staff,
    ).toBe(true);
  });

  test('runs snapshot the Plan: a later Plan edit does not change a running run', async () => {
    const f = await researchFixture();
    const run = await f.runs.start(owner(), PLAN);
    f.plans.plans.set(PLAN, bakeriesPlan({ name: 'Renamed' }));
    expect(f.store.run(run.id)?.toSnapshot().plan.name).toBe('Bakeries near Austin');
  });
});

describe('FR-21: run status and cancel', () => {
  test('cancel while running: the run is cancelled after the current Tool call and settles the real cost', async () => {
    const f = await researchFixture();
    const run = await f.runs.start(owner(), PLAN);
    const cancelled: { p?: Promise<unknown> } = {};
    f.tools.beforeCall = (req) => {
      if (req.stepKey === 'websites' && !cancelled.p) cancelled.p = f.runs.cancel(owner(), run.id);
    };
    expect(await f.executor.runAttempt(run.id)).toBe('cancelled');
    expect(await cancelled.p).toMatchObject({ status: 'running' });
    const s = f.store.run(run.id)?.toSnapshot();
    expect(s?.status).toBe('cancelled');
    expect(s?.leadsDelivered).toBe(0);
    expect(s?.creditsSpent).toBe(Math.ceil((s?.millicreditsSpent ?? 0) / 1000));
    expect(f.tools.callsOf(TOOL_KEYS.firecrawl)).toBe(1);
    expect(f.store.attempts(run.id)[0]?.status).toBe('cancelled');
    expect(f.store.outbox.map((e) => e.type)).toEqual(['RunRequested', 'RunCancelled']);
    expect(await f.available()).toBe(1000 - (s?.creditsSpent ?? 0));
  });

  test('cancel while queued stops at once and releases the Reservation; a finished run is 409 RUN_NOT_ACTIVE', async () => {
    const f = await researchFixture();
    const run = await f.runs.start(owner(), PLAN);
    expect(await f.runs.cancel(owner(), run.id)).toMatchObject({
      status: 'cancelled',
      creditsSpent: 0,
    });
    expect(await f.available()).toBe(1000);
    expect(await f.executor.runAttempt(run.id)).toBe('skipped');
    expect(await codeOf(f.runs.cancel(owner(), run.id))).toBe('RUN_NOT_ACTIVE');
    expect(await codeOf(f.runs.cancel(owner({ businessId: OTHER_BUSINESS }), run.id))).toBe(
      'NOT_FOUND',
    );
  });

  test('a running run shows the current Step; GET is scoped to the Business', async () => {
    const f = await researchFixture();
    const run = await f.runs.start(owner(), PLAN);
    const seen: { p?: Promise<unknown> } = {};
    f.tools.beforeCall = (req) => {
      if (req.stepKey === 'websites' && !seen.p) seen.p = f.runs.get(owner(), run.id);
    };
    await f.runToEnd(run.id);
    const during = runSummary.parse(await seen.p);
    expect(during.steps.find((s) => s.status === 'running')?.key).toBe('websites');
    expect(await codeOf(f.runs.get(owner({ businessId: OTHER_BUSINESS }), run.id))).toBe(
      'NOT_FOUND',
    );
  });

  test('list a Plan’s runs, newest first, paginated', async () => {
    const f = await researchFixture();
    const first = await f.runs.start(owner(), PLAN);
    await f.runs.cancel(owner(), first.id);
    f.advance(1000);
    const second = await f.runs.start(owner(), PLAN);
    const page1 = await f.runs.listForPlan(owner(), PLAN, { limit: 1 });
    expect(page1.items.map((r) => r.id)).toEqual([second.id]);
    const page2 = await f.runs.listForPlan(owner(), PLAN, {
      limit: 1,
      cursor: page1.nextCursor ?? '',
    });
    expect(page2).toMatchObject({ items: [{ id: first.id }], nextCursor: null });
    expect(
      await codeOf(f.runs.listForPlan(owner({ businessId: OTHER_BUSINESS }), PLAN, { limit: 5 })),
    ).toBe('NOT_FOUND');
  });
});

describe('FR-21 / FR-32 / FR-36: Try again and Resume', () => {
  async function failedInStep6() {
    const f = await researchFixture();
    const run = await f.runs.start(owner(), PLAN);
    f.tools.fail(TOOL_KEYS.instagram, 1, 'INSUFFICIENT_CREDITS', 'Over budget');
    expect(await f.executor.runAttempt(run.id)).toBe('final_error');
    expect(f.store.run(run.id)?.toSnapshot()).toMatchObject({ status: 'failed', creditsSpent: 0 });
    return { f, run };
  }

  test('Staff resume a run failed in Step 6: Steps 1–5 are not re-run and it continues from Step 6', async () => {
    const { f, run } = await failedInStep6();
    expect(f.store.steps(run.id).find((s) => s.key === 'socials-reviews')?.status).toBe('failed');
    const before = f.tools.providerCalls.length;
    const resumed = await f.runs.resumeAsStaff(staff(), run.id);
    expect(resumed).toMatchObject({ status: 'queued', attempt: { current: 1, max: 2 } });
    expect(await f.billing.billingQueries.getWallet(BUSINESS)).toMatchObject({ reserved: 400 });
    expect(f.store.outbox.at(-1)).toMatchObject({ type: 'RunRequested' });
    expect(f.audit.entries).toEqual([
      expect.objectContaining({
        action: 'run.resumed',
        targetId: run.id,
        staffMemberId: STAFF_ID,
        businessId: BUSINESS,
      }),
    ]);

    expect(await f.runToEnd(run.id)).toEqual(['completed']);
    const later = f.tools.providerCalls.slice(before);
    expect(later.some((c) => ['maps-places', 'websites'].includes(c.stepKey))).toBe(false);
    expect(later[0]?.stepKey).toBe('socials-reviews');
    const attempts = f.store.attempts(run.id);
    expect(attempts.map((a) => [a.status, a.fromStep])).toEqual([
      ['final_error', 'search-terms'],
      ['completed', 'socials-reviews'],
    ]);
    // Charged once, for the work after the resume: the first failure's cost stays waived.
    const s = f.store.run(run.id)?.toSnapshot();
    expect(await f.available()).toBe(1000 - (s?.creditsSpent ?? 0));
    expect(s?.creditsSpent).toBe(
      Math.ceil(((s?.millicreditsSpent ?? 0) - (s?.state.waivedMillicredits ?? 0)) / 1000),
    );
  });

  test('waived cost stays waived: after Try again, only the spend after the resume is charged', async () => {
    const { f, run } = await failedInStep6();
    const waived = f.store.run(run.id)!.toSnapshot().millicreditsSpent;
    expect(waived).toBeGreaterThan(10_000);
    expect(await f.available()).toBe(1000);

    await f.runs.resume(owner(), run.id);
    expect(await f.runToEnd(run.id)).toEqual(['completed']);
    const s = f.store.run(run.id)!.toSnapshot();
    const after = s.millicreditsSpent - waived;
    expect(after).toBeGreaterThan(0);
    expect(s.creditsSpent).toBe(Math.ceil(after / 1000));
    expect(s.creditsSpent).toBeLessThan(Math.ceil(s.millicreditsSpent / 1000));
    expect(await f.available()).toBe(1000 - s.creditsSpent);
  });

  test('Try again takes the wallet lock (the top-up) before checking for another active run', async () => {
    const { f, run } = await failedInStep6();
    const order: string[] = [];
    const commands = f.billing.billingCommands;
    const topUp = commands.topUpReservation.bind(commands);
    commands.topUpReservation = (cmd, within) => {
      order.push('topUp');
      return topUp(cmd, within);
    };
    const transaction = f.store.transaction.bind(f.store);
    f.store.transaction = <T>(fn: (tx: ResearchTx) => Promise<T>) =>
      transaction((tx) =>
        fn({
          ...tx,
          runs: {
            ...tx.runs,
            hasActive: (businessId: string) => {
              order.push('hasActive');
              return tx.runs.hasActive(businessId);
            },
          },
        }),
      );
    await f.runs.resume(owner(), run.id);
    expect(order).toEqual(['topUp', 'hasActive']);
  });

  test('the Owner’s Try again needs credits for the remaining budget (402) and a failed run (409)', async () => {
    const { f, run } = await failedInStep6();
    await f.billing.application.adjustCredits.apply({
      businessId: BUSINESS,
      credits: -700,
      reason: 'Test',
      memberId: STAFF_ID,
      idempotencyKey: 'minus',
    });
    expect(await codeOf(f.runs.resume(owner(), run.id))).toBe('INSUFFICIENT_CREDITS');
    expect(f.store.run(run.id)?.status).toBe('failed');
    await f.billing.application.adjustCredits.apply({
      businessId: BUSINESS,
      credits: 700,
      reason: 'Test',
      memberId: STAFF_ID,
      idempotencyKey: 'plus',
    });
    expect(await f.runs.resume(owner(), run.id)).toMatchObject({ status: 'queued' });
    expect(await codeOf(f.runs.resume(owner(), run.id))).toBe('RUN_NOT_FAILED');
    expect(await codeOf(f.runs.resume(owner({ businessId: OTHER_BUSINESS }), run.id))).toBe(
      'NOT_FOUND',
    );
    expect(await codeOf(f.runs.resumeAsStaff(owner(), run.id))).toBe('FORBIDDEN');
  });

  test('409 RUN_IN_PROGRESS when another run of the Business is active', async () => {
    const { f, run } = await failedInStep6();
    f.plans.plans.set(SECOND_PLAN, bakeriesPlan({ id: SECOND_PLAN }));
    await f.runs.start(owner(), SECOND_PLAN);
    expect(await codeOf(f.runs.resume(owner(), run.id))).toBe('RUN_IN_PROGRESS');
  });
});

describe('FR-32: Staff runs monitor and queue health', () => {
  test('list with filters, detail with Steps, Tool calls, attempts and handoffs; Staff only', async () => {
    const f = await researchFixture();
    const run = await f.runs.start(owner(), PLAN);
    await f.stopHook.set({ stepKey: 'websites', items: 2 });
    await f.executor.runAttempt(run.id);
    f.advance(6 * 60_000);
    await f.sweeper.sweep();
    await f.runToEnd(run.id);

    const list = await f.runs.listForStaff(staff(), { limit: 25, status: 'completed' });
    expect(list.items).toHaveLength(1);
    const row = staffRunSummary.parse(list.items[0]);
    expect(row).toMatchObject({
      business: { id: BUSINESS, name: 'Sweet Supply Co' },
      planName: 'Bakeries near Austin',
      startedBy: 'owner',
    });
    expect(
      (await f.runs.listForStaff(staff(), { limit: 25, businessId: OTHER_BUSINESS })).items,
    ).toEqual([]);

    const detail = staffRunDetail.parse(await f.runs.getForStaff(staff(), run.id));
    expect(detail.attempts.map((a) => a.outcome)).toEqual(['worker_stopped', 'completed']);
    expect(detail.attempts[0]?.handoff).toMatchObject({ stepKey: 'websites', itemsDone: 2 });
    expect(detail.attempts[1]?.from).toEqual({ stepKey: 'websites', item: 2 });
    const websites = detail.steps.find((s) => s.key === 'websites');
    expect(websites?.toolCalls.length).toBeGreaterThan(0);
    expect(websites?.checkpointBytes).toBeGreaterThan(0);

    expect(await codeOf(f.runs.listForStaff(owner(), { limit: 25 }))).toBe('FORBIDDEN');
    expect(await codeOf(f.runs.getForStaff(staff(), UNKNOWN_ID))).toBe('NOT_FOUND');
  });

  test('a retrying run shows its next attempt and the step it resumes from', async () => {
    const f = await researchFixture();
    const run = await f.runs.start(owner(), PLAN);
    for (const t of [TOOL_KEYS.googlePlaces, TOOL_KEYS.mapsScraper, TOOL_KEYS.overpass])
      f.tools.fail(t);
    await f.executor.runAttempt(run.id);
    const row = (await f.runs.listForStaff(staff(), { limit: 25 })).items[0];
    expect(row).toMatchObject({
      status: 'retrying',
      attempt: { current: 1, max: 3 },
      resumeFromStep: 'maps-places',
    });
    expect(row?.nextAttemptAt).not.toBeNull();
    expect(await f.runs.queueHealth(staff())).toMatchObject({ retrying: 1, waiting: 1, active: 2 });
  });

  test('queue health reports the sweeper and the worker heartbeat', async () => {
    const f = await researchFixture();
    await f.sweeper.sweep();
    expect(await f.runs.queueHealth(staff())).toEqual({
      waiting: 1,
      active: 2,
      failed: 0,
      delayed: 1,
      retrying: 0,
      stalledFound: 0,
      sweeperLastRunAt: f.clock.now().toISOString(),
      workerLastSeenAt: '2026-11-19T09:59:30.000Z',
    });
    expect(await codeOf(f.runs.queueHealth(owner()))).toBe('FORBIDDEN');
  });
});
