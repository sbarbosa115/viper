import type { AnalyticsTracker } from '../../../shared/application/analytics-tracker.js';
import { chargeableCredits } from '../../billing/index.js';
import { retryWaitMinutes } from '../domain/flow.js';
import { activeTimeUsed } from '../domain/guardrails.js';
import type { ResearchRun, RunFailureCode } from '../domain/run.js';
import type {
  AttemptRecord,
  AttemptStatus,
  BillingPort,
  HandoffRecord,
  HandoffValues,
  ResearchTx,
} from './ports.js';

export type RunOutcome = 'completed' | 'failed' | 'cancelled';

/**
 * Ends a run (FR-20): Settlement through billing in the same transaction (failure policy: a
 * failed run with no Leads costs nothing), then the outbox event for emails (FR-22).
 */
export async function finishRun(
  tx: ResearchTx,
  billing: BillingPort,
  run: ResearchRun,
  outcome: RunOutcome,
  code: RunFailureCode | null,
  now: Date,
): Promise<void> {
  const s = run.toSnapshot();
  const credits = chargeableCredits({
    millicreditsSpent: s.millicreditsSpent,
    outcome,
    leadsDelivered: s.leadsDelivered,
  });
  if (outcome === 'completed') run.complete(now, credits);
  else if (outcome === 'cancelled') run.cancel(now, credits);
  else run.fail(code ?? 'INTERNAL_ERROR', now, credits);
  await billing.settle({ runId: s.id, creditsSpent: credits, planName: s.plan.name }, tx.handle);
  const ended = {
    runId: s.id,
    businessId: s.businessId,
    planId: s.planId,
    startedByStaffId: s.startedByStaffId,
  };
  if (outcome === 'completed') await tx.outbox.add('RunCompleted', ended);
  else if (outcome === 'cancelled') await tx.outbox.add('RunCancelled', ended);
  else await tx.outbox.add('RunFailed', { ...ended, failureCode: code ?? 'INTERNAL_ERROR' });
}

/** `run_finished` (PRD section 3a), after the run's transaction committed. */
export async function trackRunFinished(
  analytics: AnalyticsTracker,
  run: ResearchRun,
): Promise<void> {
  const s = run.toSnapshot();
  const end = s.finishedAt ?? s.startedAt;
  await analytics.track({
    name: 'run_finished',
    actor: { memberId: s.startedByMemberId, businessId: s.businessId },
    properties: {
      run_id: s.id,
      status: s.status,
      duration_s:
        s.startedAt && end ? Math.round((end.getTime() - s.startedAt.getTime()) / 1000) : 0,
      credits_spent: s.creditsSpent,
      provider_cost_micros: s.providerCostMicros,
      leads_delivered: s.leadsDelivered,
      budget_reached: s.budgetReached,
      time_reached: s.timeReached,
      icp_edited: s.plan.icpEdited,
    },
  });
}

export function handoffValues(h: HandoffRecord | null): HandoffValues | null {
  if (!h) return null;
  return {
    stepKey: h.stepKey,
    itemsDone: h.itemsDone,
    itemsLeft: h.itemsLeft,
    notes: h.notes,
    lastError: h.lastError,
    creditsLeft: h.creditsLeft,
    activeSecondsLeft: h.activeSecondsLeft,
  };
}

export interface AttemptConclusion {
  /** The next attempt to queue (status `retrying`), else null. */
  readonly retry: { attemptN: number; delayMs: number } | null;
  /** Set when the run finished. */
  readonly finished: RunOutcome | null;
}

/**
 * Ends an attempt that did not complete the run (FR-36): cancelled, final error (the run fails at
 * once), or retryable / worker stopped (the next attempt after the flow's wait while attempts and
 * total time remain, else the run fails and settles).
 */
export async function concludeAttempt(
  tx: ResearchTx,
  deps: { billing: BillingPort },
  props: {
    run: ResearchRun;
    attempt: AttemptRecord;
    status: Exclude<AttemptStatus, 'running' | 'completed'>;
    error: { code: RunFailureCode; message: string } | null;
    activeSeconds: number;
    handoff: HandoffRecord | null;
    now: Date;
  },
): Promise<AttemptConclusion> {
  const { run, now } = props;
  run.addActiveSeconds(props.activeSeconds);
  let retry: AttemptConclusion['retry'] = null;
  let finished: RunOutcome | null = null;

  const timeUsed =
    activeTimeUsed(run.settings, run.windowActiveSeconds()) || run.totalTimeUsed(now);
  if (props.status === 'cancelled' || run.cancelRequested) {
    finished = 'cancelled';
    await finishRun(tx, deps.billing, run, 'cancelled', null, now);
  } else if (props.status === 'final_error') {
    if (props.error?.code === 'TIME_LIMIT') run.markTimeReached();
    finished = 'failed';
    await finishRun(tx, deps.billing, run, 'failed', props.error?.code ?? 'INTERNAL_ERROR', now);
  } else if (!timeUsed && run.canRetry(now)) {
    const waitMinutes = retryWaitMinutes(run.settings, run.attempts);
    run.scheduleRetry(new Date(now.getTime() + waitMinutes * 60_000));
    retry = { attemptN: run.attempts + 1, delayMs: waitMinutes * 60_000 };
  } else {
    if (timeUsed) run.markTimeReached();
    finished = 'failed';
    const code: RunFailureCode = timeUsed ? 'TIME_LIMIT' : (props.error?.code ?? 'INTERNAL_ERROR');
    await finishRun(tx, deps.billing, run, 'failed', code, now);
  }

  if (finished === 'failed' || finished === 'cancelled') {
    await markOpenSteps(
      tx,
      run.id,
      finished === 'failed' ? 'failed' : null,
      props.error?.message ?? null,
    );
  }
  const h = props.handoff;
  await tx.attempts.save({
    ...props.attempt,
    status: props.status,
    endedAt: now,
    activeSeconds: Math.max(0, Math.round(props.activeSeconds)),
    error: props.error ? `${props.error.code}: ${props.error.message}`.slice(0, 1000) : null,
    reachedStep: h?.stepKey ?? props.attempt.fromStep,
    reachedItem: h?.itemsDone ?? props.attempt.fromItem,
    handoff: handoffValues(h),
    leaseExpiresAt: null,
  });
  if (h) await tx.handoffs.save(h);
  await tx.runs.save(run);
  return { retry, finished };
}

/**
 * When a run ends early, the Step it was in shows `failed` (with the error, for Staff); a resume
 * sets failed Steps back to `pending`, keeping their progress (FR-32).
 */
export async function markOpenSteps(
  tx: ResearchTx,
  runId: string,
  to: 'failed' | 'pending' | null,
  error: string | null,
): Promise<void> {
  if (to === null) return;
  const from = to === 'failed' ? 'running' : 'failed';
  for (const step of await tx.steps.list(runId)) {
    if (step.status !== from) continue;
    await tx.steps.save({
      ...step,
      status: to,
      error: to === 'failed' ? (error?.slice(0, 1000) ?? null) : null,
    });
  }
}
