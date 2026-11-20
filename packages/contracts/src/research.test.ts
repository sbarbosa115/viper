import { describe, expect, test } from 'vitest';
import { insufficientCreditsError } from './errors.js';
import * as ex from './examples.js';
import {
  BUDGET_SHARES_MESSAGE,
  cancelRun,
  getFlow,
  getQueueHealth,
  getRun,
  getStaffRun,
  listFlows,
  listPlanRuns,
  listStaffRuns,
  resumeRun,
  startRun,
  updateFlow,
} from './research.js';

const { version: _v, ceilings: _c, ...flowInput } = ex.flow;

describe('contracts: research runs', () => {
  test('FR-18: start run errors, incl. 402 with { available, required }', () => {
    expect(startRun.response.safeParse(ex.runSummary).success).toBe(true);
    expect(startRun.errors).toContainEqual({ status: 402, code: 'INSUFFICIENT_CREDITS' });
    expect(startRun.errors).toContainEqual({ status: 409, code: 'RUN_IN_PROGRESS' });
    const body = {
      error: {
        code: 'INSUFFICIENT_CREDITS',
        message: 'x',
        details: { available: 300, required: 400 },
      },
    };
    expect(insufficientCreditsError.safeParse(body).success).toBe(true);
    expect(
      insufficientCreditsError.safeParse({ error: { ...body.error, details: {} } }).success,
    ).toBe(false);
  });

  test('RunSummary: status includes retrying; unknown statuses are rejected', () => {
    expect(
      getRun.response.safeParse({ ...ex.runSummary, status: 'retrying', takingLonger: true })
        .success,
    ).toBe(true);
    expect(getRun.response.safeParse({ ...ex.runSummary, status: 'paused' }).success).toBe(false);
    expect(getRun.response.safeParse({ ...ex.runSummary, failureReason: 'OOPS' }).success).toBe(
      false,
    );
  });

  test('plan runs, cancel and resume', () => {
    expect(
      listPlanRuns.response.safeParse({ items: [ex.runSummary], nextCursor: null }).success,
    ).toBe(true);
    expect(cancelRun.errors).toContainEqual({ status: 409, code: 'RUN_NOT_ACTIVE' });
    expect(resumeRun.errors).toContainEqual({ status: 409, code: 'RUN_NOT_FAILED' });
    expect(cancelRun.params.safeParse({ id: 'x' }).success).toBe(false);
  });

  test('FR-32: Staff run list and detail with attempts and handoffs', () => {
    expect(listStaffRuns.query.safeParse({ status: 'failed' }).success).toBe(true);
    expect(listStaffRuns.query.safeParse({ status: 'broken' }).success).toBe(false);
    expect(
      listStaffRuns.response.safeParse({ items: [ex.staffRunSummary], nextCursor: null }).success,
    ).toBe(true);
    expect(getStaffRun.response.parse(ex.staffRunDetail)).toEqual(ex.staffRunDetail);
    const longNotes = JSON.parse(JSON.stringify(ex.staffRunDetail)) as typeof ex.staffRunDetail;
    longNotes.attempts[0]!.handoff!.notes = 'x'.repeat(2001);
    expect(getStaffRun.response.safeParse(longNotes).success).toBe(false);
  });

  test('FR-32: queue health', () => {
    const q = {
      waiting: 0,
      active: 1,
      failed: 0,
      delayed: 0,
      retrying: 1,
      stalledFound: 0,
      sweeperLastRunAt: null,
      workerLastSeenAt: '2026-11-19T10:00:00.000Z',
    };
    expect(getQueueHealth.response.safeParse(q).success).toBe(true);
    expect(getQueueHealth.response.safeParse({ ...q, waiting: -1 }).success).toBe(false);
  });
});

describe('contracts: research flows (FR-37)', () => {
  test('flow shape and list', () => {
    expect(getFlow.response.parse(ex.flow)).toEqual(ex.flow);
    expect(getFlow.response.safeParse({ ...ex.flow, ceilings: undefined }).success).toBe(false);
    const item = {
      key: 'local-buyers',
      name: 'Local buyers',
      version: 1,
      isDefault: true,
      plansUsing: 3,
      updatedAt: '2026-11-19T10:00:00.000Z',
    };
    expect(listFlows.response.safeParse({ items: [item], nextCursor: null }).success).toBe(true);
  });

  test('budget shares must add up to 100%', () => {
    expect(updateFlow.body.safeParse(flowInput).success).toBe(true);
    const short = {
      ...flowInput,
      steps: flowInput.steps.map((s, i) => (i === 0 ? { ...s, budgetPct: 55 } : s)),
    };
    const res = updateFlow.body.safeParse(short);
    expect(res.error?.issues[0]?.message).toBe(BUDGET_SHARES_MESSAGE);
    expect(res.error?.issues[0]?.path).toEqual(['steps']);
  });

  test('step keys and run settings are validated', () => {
    const badKey = {
      ...flowInput,
      steps: flowInput.steps.map((s) => ({ ...s, key: 'Maps Places' })),
    };
    expect(updateFlow.body.safeParse(badKey).success).toBe(false);
    const noWaits = {
      ...flowInput,
      runSettings: { ...flowInput.runSettings, retryWaitsMinutes: [] },
    };
    expect(updateFlow.body.safeParse(noWaits).success).toBe(false);
  });
});
