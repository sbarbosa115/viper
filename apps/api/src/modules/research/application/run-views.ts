import type { RunSummary, StaffRunDetail, StaffRunSummary } from '@app/contracts/research';
import { isTakingLonger } from '../domain/guardrails.js';
import type { ResearchRun } from '../domain/run.js';
import { handoffValues } from './run-lifecycle.js';
import type { AttemptRecord, HandoffRecord, StepRecord, ToolCallView } from './ports.js';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** What customers see of a run (FR-21, FR-38): Step names only, never Tools or attempts' errors. */
export function toRunSummary(run: ResearchRun, steps: readonly StepRecord[]): RunSummary {
  const s = run.toSnapshot();
  const byKey = new Map(steps.map((st) => [st.key, st]));
  return {
    id: s.id,
    planId: s.planId,
    flow: { key: s.flow.key, version: s.flow.version },
    attempt: { current: s.attempts, max: Math.max(s.attemptLimit, s.attempts, 1) },
    takingLonger: isTakingLonger({
      status: s.status,
      attempts: s.attempts,
      activeSeconds: run.windowActiveSeconds(),
      settings: s.flow.runSettings,
    }),
    status: s.status,
    steps: s.flow.steps.map((d) => ({
      key: d.key,
      name: d.name,
      status: byKey.get(d.key)?.status ?? 'pending',
    })),
    startedAt: iso(s.startedAt),
    finishedAt: iso(s.finishedAt),
    creditsReserved: s.creditsReserved,
    creditsSpent: s.creditsSpent,
    leadsDelivered: s.leadsDelivered,
    costPerLead:
      s.leadsDelivered > 0 ? Math.round((s.creditsSpent / s.leadsDelivered) * 100) / 100 : null,
    budgetReached: s.budgetReached,
    timeReached: s.timeReached,
    failureReason: s.failureCode,
  };
}

/** The Staff runs monitor row (FR-32). */
export function toStaffRunSummary(
  run: ResearchRun,
  steps: readonly StepRecord[],
  businessName: string,
  now: Date,
): StaffRunSummary {
  const s = run.toSnapshot();
  const end = s.finishedAt ?? (s.startedAt ? now : null);
  const resumeFrom = steps
    .slice()
    .sort((a, b) => a.position - b.position)
    .find((st) => st.status !== 'done' && st.status !== 'skipped');
  return {
    ...toRunSummary(run, steps),
    business: { id: s.businessId, name: businessName },
    planName: s.plan.name,
    startedBy: s.startedByStaffId ? 'staff' : 'owner',
    durationS:
      s.startedAt && end
        ? Math.max(0, Math.round((end.getTime() - s.startedAt.getTime()) / 1000))
        : null,
    providerCostMicros: s.providerCostMicros,
    nextAttemptAt: s.status === 'retrying' ? iso(s.nextAttemptAt) : null,
    resumeFromStep:
      s.status === 'retrying' || s.status === 'failed' ? (resumeFrom?.key ?? null) : null,
  };
}

/** The Staff run detail (FR-32, FR-36): Steps with Tool calls, attempts with their handoffs. */
export function toStaffRunDetail(props: {
  run: ResearchRun;
  steps: readonly StepRecord[];
  attempts: readonly AttemptRecord[];
  handoff: HandoffRecord | null;
  toolCalls: readonly ToolCallView[];
  businessName: string;
  now: Date;
}): StaffRunDetail {
  const summary = toStaffRunSummary(props.run, props.steps, props.businessName, props.now);
  const byKey = new Map(props.steps.map((st) => [st.key, st]));
  const s = props.run.toSnapshot();
  return {
    ...summary,
    steps: s.flow.steps.map((d) => {
      const st = byKey.get(d.key);
      const end = st?.finishedAt ?? null;
      return {
        key: d.key,
        name: d.name,
        status: st?.status ?? 'pending',
        creditsSpent: (st?.millicreditsSpent ?? 0) / 1000,
        durationS:
          st?.startedAt && end
            ? Math.max(0, Math.round((end.getTime() - st.startedAt.getTime()) / 1000))
            : null,
        checkpointBytes: st?.checkpoint ? Buffer.byteLength(JSON.stringify(st.checkpoint)) : null,
        error: st?.error ?? null,
        toolCalls: props.toolCalls
          .filter((c) => c.stepKey === d.key)
          .map((c) => ({
            id: c.id,
            toolKey: c.toolKey,
            units: c.units,
            millicredits: c.millicredits,
            providerCostMicros: c.providerCostMicros,
            status: c.status,
            error: c.error,
            durationMs: c.durationMs,
            createdAt: c.createdAt.toISOString(),
            attempt: c.attemptN,
            reused: c.reused,
          })),
      };
    }),
    attempts: props.attempts.map((a) => ({
      n: a.n,
      startedAt: a.startedAt.toISOString(),
      endedAt: iso(a.endedAt),
      outcome: a.status,
      from: { stepKey: a.fromStep, item: a.fromItem },
      reached: a.reachedStep ? { stepKey: a.reachedStep, item: a.reachedItem ?? 0 } : null,
      error: a.error,
      handoff:
        a.handoff ??
        (a.status === 'running' && props.handoff?.attemptN === a.n
          ? handoffValues(props.handoff)
          : null),
    })),
  };
}
