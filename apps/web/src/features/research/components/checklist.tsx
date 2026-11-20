import type { RunStep } from '@app/contracts/research';
import { cx } from '../../../shared/ui';
import { copy } from '../copy';

const symbols = { done: '✓', running: '●', pending: '○', failed: '✕', skipped: '✓' } as const;

function stateWord(status: RunStep['status']) {
  if (status === 'running') return copy.stepCurrent;
  if (status === 'failed') return copy.stepFailed;
  return status === 'pending' ? copy.stepTodo : copy.stepDone;
}

/** Step names only: done, current, to do. No logs, no Tool names. */
export function Checklist({ steps }: { steps: RunStep[] }) {
  return (
    <ol aria-label={copy.checklist} className="m-0 flex list-none flex-col gap-1 p-0">
      {steps.map((step) => {
        const current = step.status === 'running';
        const failed = step.status === 'failed';
        return (
          <li
            key={step.key}
            aria-current={current ? 'step' : undefined}
            className={cx(
              'flex items-center gap-3 rounded-row px-3 py-2 text-[15px]',
              current && 'bg-surface text-fg',
              failed && 'text-danger',
              step.status === 'pending' && 'text-muted',
              (step.status === 'done' || step.status === 'skipped') && 'text-fg-2',
            )}
          >
            <span
              aria-hidden="true"
              className={cx('w-4 text-center font-mono', current && 'text-accent')}
            >
              {symbols[step.status]}
            </span>
            <span className="flex-1">{step.name}</span>
            <span
              className={cx(
                'font-mono text-xs uppercase tracking-wider',
                current ? 'text-accent' : 'sr-only',
                failed && 'not-sr-only',
              )}
            >
              {stateWord(step.status)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
