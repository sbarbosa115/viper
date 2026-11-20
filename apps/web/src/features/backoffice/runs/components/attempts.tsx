import type { RunAttempt, StaffRunDetail } from '@app/contracts/research';
import { Card } from '../../../../shared/ui';
import { copy, fill } from '../copy';
import { formatDuration, formatHm, secondsBetween } from '../lib/format';

type Steps = StaffRunDetail['steps'];

function where(steps: Steps, position: { stepKey: string; item: number }): string {
  const index = steps.findIndex((s) => s.key === position.stepKey);
  const name = steps[index]?.name ?? position.stepKey;
  const label = index === -1 ? name : `step ${index + 1} ${name}`;
  return position.item > 0 ? `${label}, item ${position.item}` : label;
}

/** FR-36: what the previous attempt left for this one (the handoff). */
function Handoff({ attempt, from, steps }: { attempt: number; from: RunAttempt; steps: Steps }) {
  const h = from.handoff;
  if (!h) return null;
  const step = steps.find((s) => s.key === h.stepKey)?.name ?? h.stepKey;
  return (
    <Card tone="accent" className="mt-3 flex flex-col gap-3 !p-4">
      <h4 className="m-0 text-sm font-semibold text-fg">
        {fill(copy.handoffTitle, { n: attempt })}
      </h4>
      <p className="m-0 font-mono text-xs text-fg-2">
        {fill(copy.handoffStep, { step, done: h.itemsDone, left: h.itemsLeft })}
      </p>
      <div>
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
          {copy.agentNotes}
        </p>
        <p className="m-0 mt-1 whitespace-pre-wrap text-sm text-fg-2">{h.notes || copy.noNotes}</p>
      </div>
      <dl className="m-0 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted">{copy.lastError}</dt>
          <dd className="m-0 font-mono text-fg-2">{h.lastError ?? copy.none}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{copy.creditsLeft}</dt>
          <dd className="m-0 font-mono text-fg-2">{h.creditsLeft}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{copy.activeLeft}</dt>
          <dd className="m-0 font-mono text-fg-2">{formatDuration(h.activeSecondsLeft)}</dd>
        </div>
      </dl>
    </Card>
  );
}

/** FR-32/FR-36: one entry per attempt, with the wait between attempts and each handoff. */
export function Attempts({ attempts, steps }: { attempts: RunAttempt[]; steps: Steps }) {
  return (
    <section aria-label={copy.attempts} className="flex flex-col gap-3">
      <h2 className="m-0 text-lg font-semibold text-fg">{copy.attempts}</h2>
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {attempts.map((a, i) => {
          const previous = attempts[i - 1];
          const waited =
            previous?.endedAt != null ? secondsBetween(previous.endedAt, a.startedAt) : null;
          const failed =
            a.outcome === 'retryable_error' ||
            a.outcome === 'final_error' ||
            a.outcome === 'worker_stopped';
          return (
            <li key={a.n}>
              {waited !== null && (
                <p className="m-0 mb-3 font-mono text-xs text-muted">
                  {fill(copy.waited, { min: Math.round(waited / 60) })}
                </p>
              )}
              <div className="rounded-card border border-line-strong bg-surface p-4">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <h3 className="m-0 text-base font-semibold text-fg">
                    {fill(copy.attempt, { n: a.n })}
                  </h3>
                  <span className="font-mono text-xs text-muted">
                    {formatHm(a.startedAt)}–{a.endedAt ? formatHm(a.endedAt) : '…'}
                  </span>
                </div>
                <p className="m-0 mt-1 text-sm text-fg-2">
                  {fill(copy.startedAt, { where: where(steps, a.from) })}
                  {a.reached && ` · ${fill(copy.reached, { where: where(steps, a.reached) })}`}
                </p>
                <p
                  className={failed ? 'm-0 mt-1 text-sm text-danger' : 'm-0 mt-1 text-sm text-fg-2'}
                >
                  {copy.outcome[a.outcome]}
                  {a.error && ` (${a.error})`}
                </p>
                {a.endedAt && (
                  <p className="m-0 mt-1 font-mono text-xs text-muted">
                    {fill(copy.activeCredits, {
                      min: Math.round(secondsBetween(a.startedAt, a.endedAt) / 60),
                    })}
                  </p>
                )}
                {previous && <Handoff attempt={a.n} from={previous} steps={steps} />}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
