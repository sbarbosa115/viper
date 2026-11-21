import type { RunRef } from '@app/contracts/support';
import type { ResearchRun } from '../domain/run.js';
import type { ResearchStore, StepRecord } from './ports.js';

/** A run with what support's ticket view and ownership check need. */
export type SupportRun = RunRef & { businessId: string; attempt: number; lastError: string | null };

const REF_STATUS = {
  queued: 'running',
  running: 'running',
  retrying: 'retrying',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
} as const;

/** The step a failed or cancelled run stopped in: the failed one, else the first unfinished. */
function stoppedStep(run: ResearchRun, steps: readonly StepRecord[]): RunRef['stoppedStep'] {
  const s = run.toSnapshot();
  if (s.status !== 'failed' && s.status !== 'cancelled') return null;
  const byKey = new Map(steps.map((st) => [st.key, st]));
  const statusOf = (key: string) => byKey.get(key)?.status ?? 'pending';
  const defs = s.flow.steps;
  const index = defs.findIndex((d) => statusOf(d.key) === 'failed');
  const at =
    index >= 0 ? index : defs.findIndex((d) => !['done', 'skipped'].includes(statusOf(d.key)));
  const def = defs[at];
  return def ? { number: at + 1, name: def.name } : null;
}

function toRunRef(run: ResearchRun, steps: readonly StepRecord[]): RunRef {
  const s = run.toSnapshot();
  return {
    id: s.id,
    planId: s.planId,
    planName: s.plan.name,
    startedAt: (s.startedAt ?? s.queuedAt).toISOString(),
    status: REF_STATUS[s.status],
    stoppedStep: stoppedStep(run, steps),
    creditsCharged: s.creditsSpent,
  };
}

/** research's reads for the support module (prd-support section 7, `ResearchForSupport`). */
export class ResearchSupportQueries {
  constructor(private readonly store: ResearchStore) {}

  /** The Business's runs queued at or after `since`, newest first, at most `limit`. */
  recentRunsForBusiness(businessId: string, since: Date, limit: number): Promise<RunRef[]> {
    return this.store.transaction(async (tx) => {
      const runs = await tx.runs.recentForBusiness(businessId, since, limit);
      const steps = await tx.steps.listForRuns(runs.map((r) => r.id));
      return runs.map((r) => toRunRef(r, steps.get(r.id) ?? []));
    });
  }

  /** One run of any Business; null when it doesn't exist. */
  runForSupport(runId: string): Promise<SupportRun | null> {
    return this.store.transaction(async (tx) => {
      const run = await tx.runs.find(runId);
      if (!run) return null;
      const [steps, attempt] = await Promise.all([tx.steps.list(runId), tx.attempts.latest(runId)]);
      const s = run.toSnapshot();
      const failedStep = steps.find((st) => st.error);
      return {
        ...toRunRef(run, steps),
        businessId: s.businessId,
        attempt: s.attempts,
        lastError: attempt?.error ?? failedStep?.error ?? null,
      };
    });
  }
}
