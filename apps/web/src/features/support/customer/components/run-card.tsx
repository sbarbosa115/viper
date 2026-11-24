import type { RunRef } from '@app/contracts/support';
import { Link } from 'react-router';
import { copy, fill } from '../../copy';
import { formatDateTime } from '../lib/format';

/** The linked run (FR-4): plan, start, where it stopped, status, credits charged, "Open run". */
export function RunCard({ run }: { run: RunRef }) {
  const stopped = run.stoppedStep
    ? fill(copy.runStopped, {
        number: String(run.stoppedStep.number).padStart(2, '0'),
        name: run.stoppedStep.name,
      })
    : null;
  return (
    <Link
      to={`/runs/${run.id}`}
      className="flex flex-col gap-1 rounded-row border border-line-strong bg-surface p-3.5 text-fg hover:bg-raised"
    >
      <b className="text-sm font-semibold">{run.planName}</b>
      <span className="text-[13px] text-muted">
        {fill(copy.runStarted, { when: formatDateTime(run.startedAt) })}
        {stopped && ` · ${stopped}`}
      </span>
      <span className="font-mono text-[11px] uppercase text-muted">
        {run.status} · {fill(copy.runCharged, { count: run.creditsCharged })} · {copy.openRun} ›
      </span>
    </Link>
  );
}
