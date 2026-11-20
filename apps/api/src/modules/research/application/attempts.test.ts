import { describe, expect, test } from 'vitest';
import { TOOL_KEYS } from '../domain/local-buyers.js';
import { owner, PLAN, researchFixture, type ResearchFixture } from '../test/research-fixture.js';
import { WorkerStopSignal } from './run-errors.js';

const MAPS_TOOLS = [TOOL_KEYS.googlePlaces, TOOL_KEYS.mapsScraper, TOOL_KEYS.overpass];
const COLLECTED_STEPS = ['search-terms', 'maps-places', 'merge', 'pre-score', 'websites'];

/** Data providers' spend (Claude's re-reading of the handoff in a new session is extra). */
function providerSpend(f: ResearchFixture, runId: string): number {
  return f.tools.calls
    .filter((c) => c.runId === runId && !c.toolKey.startsWith('claude.'))
    .reduce((sum, c) => sum + c.millicredits, 0);
}

/** A clean run's provider spend, to compare with a run that crashed (one pass of work). */
async function cleanRunSpend(): Promise<number> {
  const f = await researchFixture();
  const run = await f.runs.start(owner(), PLAN);
  await f.runToEnd(run.id);
  return providerSpend(f, run.id);
}

async function expireLease(f: ResearchFixture) {
  f.advance(3 * 60_000);
  return f.sweeper.sweep();
}

describe('FR-36 / AJ-9: the worker stops in Step 5 after 12 websites', () => {
  test('the sweeper ends attempt 1 as worker_stopped; attempt 2 resumes at website 13 from the handoff', async () => {
    const f = await researchFixture();
    const started = await f.runs.start(owner(), PLAN);
    await f.stopHook.set({ stepKey: 'websites', items: 12 });

    expect(await f.executor.runAttempt(started.id)).toBe('stopped');
    const websitesRead = f.tools.callsOf(TOOL_KEYS.firecrawl);
    expect(websitesRead).toBe(12);
    const notes = f.store.handoff(started.id)?.notes ?? '';
    expect(notes).toContain('websites: 11 of 25');

    // The lease is still live: nothing happens yet.
    expect((await f.sweeper.sweep()).stalled).toBe(0);
    expect(f.store.run(started.id)?.status).toBe('running');

    expect((await expireLease(f)).stalled).toBe(1);
    const retrying = await f.runs.get(owner(), started.id);
    expect(retrying).toMatchObject({ status: 'retrying', takingLonger: true });
    expect(JSON.stringify(retrying)).not.toContain('attempt 2');
    expect(f.queue.jobs).toEqual([{ runId: started.id, attemptN: 2, delayMs: 60_000 }]);

    const requestsBefore = f.llm.requests.length;
    expect(await f.runToEnd(started.id)).toEqual(['completed']);

    // Website 13 onwards only: the 12 stored websites are not fetched or charged again.
    expect(f.tools.callsOf(TOOL_KEYS.firecrawl)).toBe(25);
    const attempt2Websites = f.tools.calls.filter(
      (c) => c.stepKey === 'websites' && c.toolKey === TOOL_KEYS.firecrawl && c.attemptN === 2,
    );
    expect(attempt2Websites).toHaveLength(13);
    // Steps 1–4 are not repeated in attempt 2.
    const attempt2Steps = new Set(
      f.tools.calls.filter((c) => c.attemptN === 2).map((c) => c.stepKey),
    );
    expect(attempt2Steps.has('maps-places')).toBe(false);
    const firstPrompt = f.llm.requests
      .slice(requestsBefore)
      .find((r) => r.purpose === 'research.step.websites');
    expect(firstPrompt?.messages[0]?.content).toContain(notes);
    expect(
      f.llm.requests.slice(requestsBefore).some((r) => r.purpose === 'research.step.search-terms'),
    ).toBe(false);

    const attempts = f.store.attempts(started.id);
    expect(attempts.map((a) => a.status)).toEqual(['worker_stopped', 'completed']);
    expect(attempts[0]).toMatchObject({ reachedStep: 'websites', reachedItem: 12 });
    expect(attempts[1]).toMatchObject({ fromStep: 'websites', fromItem: 12 });
    expect(attempts[0]?.handoff?.notes).toBe(notes);

    // Settlement equals one pass of provider work.
    expect(providerSpend(f, started.id)).toBe(await cleanRunSpend());
    expect(
      f.analytics.events
        .filter((e) => e.name === 'run_attempt_finished')
        .map((e) => e.properties?.outcome),
    ).toEqual(['worker_stopped', 'completed']);
  });

  test('FR-38: the second attempt shows "taking longer" while it runs, without attempt numbers for customers', async () => {
    const f = await researchFixture();
    const started = await f.runs.start(owner(), PLAN);
    await f.stopHook.set({ stepKey: 'websites', items: 3 });
    await f.executor.runAttempt(started.id);
    await expireLease(f);
    let during: unknown = null;
    f.tools.beforeCall = (req) => {
      if (req.attemptN === 2 && !during) during = f.runs.get(owner(), started.id);
    };
    await f.runToEnd(started.id);
    expect(await (during as Promise<unknown>)).toMatchObject({
      status: 'running',
      takingLonger: true,
    });
  });
});

describe('FR-19: crash between Steps', () => {
  test('after Step 5, a retry does not repeat Steps 1–5 or charge their Tool calls twice', async () => {
    const f = await researchFixture();
    const started = await f.runs.start(owner(), PLAN);
    f.tools.beforeCall = (req) => {
      if (req.stepKey === 'socials-reviews' && req.attemptN === 1) throw new WorkerStopSignal();
    };
    expect(await f.executor.runAttempt(started.id)).toBe('stopped');
    const steps = f.store.steps(started.id);
    for (const key of COLLECTED_STEPS)
      expect(steps.find((s) => s.key === key)?.status).toBe('done');
    const callsBefore = f.tools.providerCalls.filter((c) =>
      COLLECTED_STEPS.includes(c.stepKey),
    ).length;
    const llmBefore = f.llm.requests.filter((r) =>
      COLLECTED_STEPS.some((k) => r.purpose.endsWith(k)),
    ).length;
    const spentBefore = f.store.run(started.id)?.toSnapshot().millicreditsSpent ?? 0;

    f.tools.beforeCall = null;
    await expireLease(f);
    expect(await f.runToEnd(started.id)).toEqual(['completed']);

    expect(f.tools.providerCalls.filter((c) => COLLECTED_STEPS.includes(c.stepKey))).toHaveLength(
      callsBefore,
    );
    expect(
      f.llm.requests.filter((r) => COLLECTED_STEPS.some((k) => r.purpose.endsWith(k))),
    ).toHaveLength(llmBefore);
    const collectedCharges = f.tools.calls
      .filter((c) => c.attemptN === 2 && COLLECTED_STEPS.includes(c.stepKey ?? ''))
      .reduce((sum, c) => sum + c.millicredits, 0);
    expect(collectedCharges).toBe(0);
    expect(f.store.run(started.id)?.toSnapshot().millicreditsSpent).toBeGreaterThan(spentBefore);
  });
});

describe('FR-19 / FR-36: retryable and final errors', () => {
  test('a provider down for the first attempt: the automatic retry resumes it and the run completes', async () => {
    const f = await researchFixture();
    const started = await f.runs.start(owner(), PLAN);
    for (const t of MAPS_TOOLS) f.tools.fail(t);
    expect(await f.executor.runAttempt(started.id)).toBe('retryable_error');
    // FR-20 backoff 1 s, 4 s, 16 s for each failed call.
    expect(f.sleeper.waits.slice(0, 3)).toEqual([1_000, 4_000, 16_000]);
    expect(f.store.run(started.id)?.toSnapshot()).toMatchObject({
      status: 'retrying',
      failureCode: null,
    });
    expect(f.store.handoff(started.id)?.lastError).toContain('Provider is down');
    expect(f.queue.jobs).toEqual([{ runId: started.id, attemptN: 2, delayMs: 60_000 }]);

    for (const t of MAPS_TOOLS) f.tools.heal(t);
    expect(await f.runToEnd(started.id)).toEqual(['completed']);
    expect(f.store.run(started.id)?.toSnapshot().leadsDelivered).toBe(10);
  });

  test('a provider error on every call: after 3 failed attempts the run fails under the failure policy', async () => {
    const f = await researchFixture();
    const started = await f.runs.start(owner(), PLAN);
    for (const t of MAPS_TOOLS) f.tools.fail(t);
    expect(await f.runToEnd(started.id)).toEqual([
      'retryable_error',
      'retryable_error',
      'retryable_error',
    ]);
    const run = f.store.run(started.id)?.toSnapshot();
    expect(run).toMatchObject({
      status: 'failed',
      failureCode: 'PROVIDER_ERROR',
      creditsSpent: 0,
      attempts: 3,
    });
    expect(f.queue.jobs.map((j) => [j.attemptN, j.delayMs])).toEqual([
      [2, 60_000],
      [3, 300_000],
    ]);
    // Failed with no Leads: free, the whole Reservation released.
    expect(await f.available()).toBe(1000);
    expect(f.store.outbox.map((e) => e.type)).toEqual(['RunRequested', 'RunFailed']);
    expect(f.store.steps(started.id).find((s) => s.key === 'maps-places')?.status).toBe('failed');
  });

  test('credits running out mid-step fail the run with INSUFFICIENT_CREDITS and no further attempt', async () => {
    const f = await researchFixture();
    const started = await f.runs.start(owner(), PLAN);
    f.tools.fail(TOOL_KEYS.firecrawl, 1, 'INSUFFICIENT_CREDITS', 'Over budget');
    expect(await f.executor.runAttempt(started.id)).toBe('final_error');
    expect(f.store.run(started.id)?.toSnapshot()).toMatchObject({
      status: 'failed',
      failureCode: 'INSUFFICIENT_CREDITS',
      attempts: 1,
    });
    expect(f.queue.jobs).toEqual([]);
    expect(f.store.attempts(started.id)[0]?.status).toBe('final_error');
  });

  test('a provider no longer configured for a required Step fails the run at once', async () => {
    const f = await researchFixture();
    const started = await f.runs.start(owner(), PLAN);
    f.tools.unconfigured.add(TOOL_KEYS.firecrawl);
    expect(await f.executor.runAttempt(started.id)).toBe('final_error');
    expect(f.store.run(started.id)?.toSnapshot().failureCode).toBe('PROVIDER_NOT_CONFIGURED');
    expect(f.queue.jobs).toEqual([]);
  });

  test('a disabled optional Step is skipped and recorded; the run completes', async () => {
    const f = await researchFixture();
    const started = await f.runs.start(owner(), PLAN);
    f.tools.disabled.add(TOOL_KEYS.instagram);
    f.tools.disabled.add(TOOL_KEYS.yelp);
    expect(await f.runToEnd(started.id)).toEqual(['completed']);
    const step = f.store.steps(started.id).find((s) => s.key === 'socials-reviews');
    expect(step).toMatchObject({ status: 'skipped', checkpoint: { skipped: 'tools_unavailable' } });
  });

  test('a Tool failing 5 calls in a row is disabled for the run', async () => {
    const f = await researchFixture();
    const started = await f.runs.start(owner(), PLAN);
    f.tools.fail(TOOL_KEYS.googlePlaces);
    expect(await f.runToEnd(started.id)).toEqual(['completed']);
    // 1 call + 3 retries, then 1 more: the fifth failure in a row switches it off.
    expect(f.tools.callsOf(TOOL_KEYS.googlePlaces)).toBe(5);
  });

  test('Claude unavailable: retried with backoff, then the attempt ends as retryable and the next completes', async () => {
    const f = await researchFixture();
    const started = await f.runs.start(owner(), PLAN);
    f.llm.failNext(4);
    expect(await f.runToEnd(started.id)).toEqual(['retryable_error', 'completed']);
    expect(f.sleeper.waits.slice(0, 3)).toEqual([1_000, 4_000, 16_000]);
    expect(f.store.attempts(started.id)[0]?.error).toContain('PROVIDER_ERROR: Claude');
  });

  test('an unexpected error ends the attempt as retryable and the next attempt continues', async () => {
    const f = await researchFixture();
    const started = await f.runs.start(owner(), PLAN);
    let thrown = false;
    f.tools.beforeCall = (req) => {
      if (req.stepKey === 'verify' && !thrown) {
        thrown = true;
        throw new Error('socket hang up');
      }
    };
    expect(await f.runToEnd(started.id)).toEqual(['retryable_error', 'completed']);
    expect(f.store.attempts(started.id)[0]?.error).toContain('INTERNAL_ERROR: socket hang up');
  });
});

describe('FR-36: lease', () => {
  test('a worker whose lease the sweeper took over stops without writing', async () => {
    const f = await researchFixture();
    const started = await f.runs.start(owner(), PLAN);
    let swept = false;
    f.tools.beforeCall = (req) => {
      if (req.stepKey !== 'websites' || swept) return;
      swept = true;
      // The worker freezes for 3 minutes after this call; meanwhile the sweeper ends the attempt.
      f.store.runAfterCommit(async () => {
        f.advance(3 * 60_000);
        await f.sweeper.sweep();
      });
    };
    expect(await f.executor.runAttempt(started.id)).toBe('lease_lost');
    expect(swept).toBe(true);
    expect(f.store.attempts(started.id)[0]?.status).toBe('worker_stopped');
    expect(f.store.run(started.id)?.status).toBe('retrying');
  });

  test('a duplicate job for a run that is already running does nothing', async () => {
    const f = await researchFixture();
    const started = await f.runs.start(owner(), PLAN);
    await f.runToEnd(started.id);
    expect(await f.executor.runAttempt(started.id)).toBe('skipped');
  });

  test('the sweeper queues due retries and queued runs whose job was lost', async () => {
    const f = await researchFixture();
    const started = await f.runs.start(owner(), PLAN);
    f.advance(2 * 60_000);
    expect((await f.sweeper.sweep()).requeued).toBe(1);
    expect(f.queue.jobs).toEqual([{ runId: started.id, attemptN: 1, delayMs: 0 }]);
    expect(f.monitor.lastSweep?.at).toEqual(f.clock.now());
  });
});
