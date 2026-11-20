import type { Evidence } from '@app/contracts/leads';
import { cx } from '../../../shared/ui';
import { copy } from '../copy';
import { formatDate, formatPoints, safeUrl } from '../lib/format';

/** The reasons behind the Fit score: fact, points, and the Source with its link and date. */
export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) return <p className="m-0 text-sm text-muted">{copy.noEvidence}</p>;
  return (
    <ul aria-label={copy.evidence} className="m-0 flex list-none flex-col p-0">
      {evidence.map((e, i) => {
        const href = safeUrl(e.source.url);
        return (
          <li
            key={`${i}-${e.fact}`}
            className="flex items-baseline justify-between gap-4 border-t border-line py-2.5 text-sm first:border-t-0"
          >
            <span className="min-w-0 text-fg-2">
              {e.fact}{' '}
              <span className="whitespace-nowrap text-[13px] text-muted">
                ·{' '}
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    {e.source.name}
                  </a>
                ) : (
                  e.source.name
                )}{' '}
                · {formatDate(e.source.retrievedAt)}
              </span>
            </span>
            <span className={cx('font-mono text-sm', e.points < 0 ? 'text-warn' : 'text-accent')}>
              <span className="sr-only">Points </span>
              {formatPoints(e.points)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
