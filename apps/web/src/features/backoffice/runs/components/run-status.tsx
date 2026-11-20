import type { StaffRunSummary } from '@app/contracts/research';
import { StatusPill, type StatusKind } from '../../../../shared/ui';
import { copy, fill } from '../copy';

const kinds: Record<StaffRunSummary['status'], StatusKind> = {
  queued: 'cancelled',
  running: 'running',
  retrying: 'retrying',
  completed: 'ok',
  failed: 'failed',
  cancelled: 'cancelled',
};

function stepNumber(run: StaffRunSummary, key: string | null): string {
  if (key === null) return copy.none;
  const index = run.steps.findIndex((s) => s.key === key);
  return index === -1 ? key : String(index + 1);
}

function runningStep(run: StaffRunSummary): number {
  const index = run.steps.findIndex((s) => s.status === 'running');
  return index === -1 ? run.steps.filter((s) => s.status === 'done').length + 1 : index + 1;
}

/** The note after the status word: "attempt 2 of 3 · from step 5", "step 2 of 10", "after 3 attempts". */
export function statusNote(run: StaffRunSummary): string | null {
  switch (run.status) {
    case 'retrying':
      return fill(copy.retryingLine, {
        n: run.attempt.current,
        m: run.attempt.max,
        k: stepNumber(run, run.resumeFromStep),
      });
    case 'running':
      return fill(copy.runningLine, { k: runningStep(run), n: run.steps.length });
    case 'completed':
      return run.budgetReached ? copy.budgetReached : run.timeReached ? copy.timeReached : null;
    case 'failed':
      return [
        run.failureReason,
        run.attempt.current > 1 ? fill(copy.afterAttempts, { n: run.attempt.current }) : null,
      ]
        .filter(Boolean)
        .join(' · ');
    default:
      return null;
  }
}

/** Status is always a word plus a symbol, with the retry or failure detail after it. */
export function RunStatus({ run }: { run: StaffRunSummary }) {
  const note = statusNote(run);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      <StatusPill kind={kinds[run.status]} label={copy.statuses[run.status]} />
      {note && <span className="text-xs text-muted">· {note}</span>}
    </span>
  );
}
