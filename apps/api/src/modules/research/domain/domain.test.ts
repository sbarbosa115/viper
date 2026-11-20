import { describe, expect, test } from 'vitest';
import { DomainRuleViolation } from '../../../shared/domain/errors.js';
import { changedFlowFields, retryWaitMinutes, validateFlowSettings } from './flow.js';
import {
  collectionStop,
  isTakingLonger,
  stepAllowanceMillicredits,
  stepTimeUsed,
} from './guardrails.js';
import { LOCAL_BUYERS_V1 } from './local-buyers.js';
import { ResearchRun, type PlanSnapshot } from './run.js';

const CEILINGS = {
  maxCredits: 1000,
  maxLeads: 500,
  maxActiveMinutes: 120,
  maxTotalHours: 4,
  maxAttempts: 5,
};
const settings = LOCAL_BUYERS_V1.runSettings;
const t0 = new Date('2026-11-19T10:00:00.000Z');
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

const plan: PlanSnapshot = {
  id: 'plan',
  businessId: 'biz',
  flowKey: 'local-buyers',
  name: 'Bakeries',
  goal: 'g',
  segments: [],
  searchArea: { label: 'Austin', lat: 30, lng: -97, radiusMiles: 3 },
  guardrails: { maxCredits: 400, maxLeads: 50, minFitScore: 60 },
  icpEdited: false,
};

function newRun() {
  return ResearchRun.queue({
    id: 'run',
    flowId: 'flow',
    flow: LOCAL_BUYERS_V1,
    plan,
    promptVersion: 'v1',
    startedByMemberId: 'm',
    startedByStaffId: null,
    now: t0,
  });
}

describe('FR-37: flow settings validation', () => {
  const { key: _key, version: _version, ...seeded } = LOCAL_BUYERS_V1;

  test('the seeded "Local buyers" settings are valid; shares add up to 100', () => {
    expect(validateFlowSettings(seeded, CEILINGS, LOCAL_BUYERS_V1)).toEqual({});
    expect(LOCAL_BUYERS_V1.steps.reduce((s, x) => s + x.budgetPct, 0)).toBe(100);
  });

  test('values over a ceiling name the field and the ceiling', () => {
    const errors = validateFlowSettings(
      { ...seeded, runSettings: { ...settings, maxTotalHours: 5 } },
      CEILINGS,
      LOCAL_BUYERS_V1,
    );
    expect(errors).toEqual({ 'runSettings.maxTotalHours': 'Ceiling 4 h (Settings)' });
  });

  test('shares not adding up to 100, steps changed, always-required steps, scoring after max active time', () => {
    const steps = seeded.steps.map((s) =>
      s.key === 'score-pitch' ? { ...s, required: false, budgetPct: 7 } : s,
    );
    expect(
      validateFlowSettings(
        { ...seeded, steps, runSettings: { ...settings, scoreAtMinutes: 70 } },
        CEILINGS,
        LOCAL_BUYERS_V1,
      ),
    ).toEqual({
      steps: 'Step budget shares must add up to 100%',
      'steps.8.required': 'Score & pitch is always required',
      'runSettings.scoreAtMinutes': 'Must be at most the max active time',
    });
    expect(
      validateFlowSettings({ ...seeded, steps: seeded.steps.slice(1) }, CEILINGS, LOCAL_BUYERS_V1)
        .steps,
    ).toBeDefined();
  });

  test('changed fields and retry waits (the last value repeats)', () => {
    expect(
      changedFlowFields(seeded, {
        ...seeded,
        name: 'X',
        planDefaults: { ...seeded.planDefaults, maxLeads: 20 },
      }),
    ).toEqual(['name', 'planDefaults.maxLeads']);
    expect([1, 2, 3, 4].map((n) => retryWaitMinutes(settings, n))).toEqual([1, 5, 15, 15]);
  });
});

describe('FR-20: guardrails', () => {
  test('a Step’s allowance is its share plus what earlier Steps left unused', () => {
    const steps = LOCAL_BUYERS_V1.steps;
    // Step 2 (index 1): 2% + 30% of 400 credits, nothing spent before.
    expect(
      stepAllowanceMillicredits({
        steps,
        index: 1,
        maxCredits: 400,
        spentBefore: 0,
        spentInStep: 0,
      }),
    ).toBe(128_000);
    expect(
      stepAllowanceMillicredits({
        steps,
        index: 1,
        maxCredits: 400,
        spentBefore: 8_000,
        spentInStep: 100_000,
      }),
    ).toBe(20_000);
  });

  test('collection stops at 80% of max credits or 45 active minutes', () => {
    expect(
      collectionStop({ settings, spentMillicredits: 319_999, maxCredits: 400, activeSeconds: 0 }),
    ).toBeNull();
    expect(
      collectionStop({ settings, spentMillicredits: 320_000, maxCredits: 400, activeSeconds: 0 }),
    ).toBe('budget');
    expect(
      collectionStop({ settings, spentMillicredits: 0, maxCredits: 400, activeSeconds: 45 * 60 }),
    ).toBe('time');
    expect(stepTimeUsed(LOCAL_BUYERS_V1.steps[1]!, 15 * 60)).toBe(true);
  });

  test('FR-38: taking longer while retrying, in a later attempt, or past max active time', () => {
    expect(isTakingLonger({ status: 'running', attempts: 1, activeSeconds: 60, settings })).toBe(
      false,
    );
    expect(isTakingLonger({ status: 'retrying', attempts: 1, activeSeconds: 60, settings })).toBe(
      true,
    );
    expect(isTakingLonger({ status: 'running', attempts: 2, activeSeconds: 60, settings })).toBe(
      true,
    );
    expect(isTakingLonger({ status: 'running', attempts: 1, activeSeconds: 3600, settings })).toBe(
      true,
    );
    expect(
      isTakingLonger({ status: 'completed', attempts: 2, activeSeconds: 3600, settings }),
    ).toBe(false);
  });
});

describe('FR-36: a run’s attempts', () => {
  test('attempts, retries and the attempt limit', () => {
    const run = newRun();
    expect(run.beginAttempt(t0)).toBe(1);
    expect(() => run.beginAttempt(t0)).toThrow(DomainRuleViolation);
    run.scheduleRetry(at(1));
    expect(run.toSnapshot()).toMatchObject({ status: 'retrying', nextAttemptAt: at(1) });
    expect(run.canRetry(at(1))).toBe(true);
    run.beginAttempt(at(1));
    run.scheduleRetry(at(6));
    run.beginAttempt(at(6));
    expect(run.canRetry(at(7))).toBe(false);
  });

  test('total time counts from the first start; active time only while attempts run', () => {
    const run = newRun();
    run.beginAttempt(t0);
    run.addActiveSeconds(600);
    expect(run.totalTimeUsed(at(179))).toBe(false);
    expect(run.totalTimeUsed(at(180))).toBe(true);
    expect(run.canRetry(at(181))).toBe(false);
    expect(run.windowActiveSeconds(30)).toBe(630);
  });

  test('a Tool failing 5 calls in a row is disabled; a success resets the count; a new attempt clears it', () => {
    const run = newRun();
    run.beginAttempt(t0);
    for (let i = 0; i < 4; i += 1) expect(run.recordToolFailure('x').disabled).toBe(false);
    run.recordToolSuccess('x');
    for (let i = 0; i < 4; i += 1) run.recordToolFailure('x');
    expect(run.recordToolFailure('x').disabled).toBe(true);
    expect(run.isToolDisabled('x')).toBe(true);
    run.scheduleRetry(at(1));
    run.beginAttempt(at(1));
    expect(run.isToolDisabled('x')).toBe(false);
  });

  test('cancel: immediate when not running; resume only a failed run, with a fresh window and one more attempt', () => {
    const queued = newRun();
    expect(queued.requestCancel(t0)).toEqual({ immediate: true });
    const run = newRun();
    run.beginAttempt(t0);
    expect(run.requestCancel(t0)).toEqual({ immediate: false });
    expect(() => run.resume(t0)).toThrow(DomainRuleViolation);

    const failed = newRun();
    failed.beginAttempt(t0);
    failed.addActiveSeconds(3_000);
    failed.addSpend(120_500, 0);
    failed.fail('PROVIDER_ERROR', at(60), 0);
    expect(() => failed.complete(at(61), 1)).toThrow(DomainRuleViolation);
    failed.resume(at(300));
    expect(failed.toSnapshot()).toMatchObject({
      status: 'queued',
      attemptLimit: 2,
      failureCode: null,
      windowStartedAt: at(300),
    });
    expect(failed.windowActiveSeconds()).toBe(0);
    expect(failed.resumeHoldCredits).toBe(400);
    expect(failed.remainingMillicredits).toBe(279_500);
  });
});
