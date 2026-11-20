import type { Source } from '@app/contracts/common';
import { useId, type ReactNode } from 'react';
import { copy, fill } from '../copy';
import { describeSource, safeUrl } from '../lib/format';

/**
 * A focusable value whose Source shows on hover or keyboard focus (FR-26). The tooltip is also
 * the element's accessible description, so screen readers hear the Source too.
 */
export function WithSource({ source, children }: { source: Source; children: ReactNode }) {
  const tipId = useId();
  const href = safeUrl(source.url);
  return (
    <span className="group relative inline-block">
      <span
        tabIndex={0}
        aria-describedby={tipId}
        className="rounded-sm underline decoration-dotted decoration-faint underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
      >
        {children}
      </span>
      <span
        id={tipId}
        role="tooltip"
        className="invisible absolute left-0 top-full z-10 mt-1 w-max max-w-64 rounded-row border border-line-strong bg-raised px-3 py-2 text-[13px] text-fg-2 shadow-overlay group-focus-within:visible group-hover:visible"
      >
        {fill(copy.sourceLabel, { source: describeSource(source) })}
        {href && (
          <>
            {' '}
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              {copy.openSource}
            </a>
          </>
        )}
      </span>
    </span>
  );
}
