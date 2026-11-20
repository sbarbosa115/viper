import type { ReactNode } from 'react';
import { cx } from './cx';

export interface ListRowProps {
  selected?: boolean;
  onSelect?: () => void;
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
}

/** Dense list row; selection is a lime inset bar on the left plus the surface colour. */
export function ListRow({
  selected = false,
  onSelect,
  leading,
  title,
  meta,
  trailing,
}: ListRowProps) {
  const body = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-fg">{title}</span>
        {meta && <span className="block truncate text-[13px] text-muted">{meta}</span>}
      </span>
      {trailing}
    </>
  );
  const cls = cx(
    'flex w-full items-center gap-3 rounded-row px-4 py-3 text-left',
    selected && 'bg-surface shadow-[inset_2px_0_0_var(--accent)]',
    onSelect && !selected && 'hover:bg-surface',
  );
  return onSelect ? (
    <button type="button" aria-current={selected || undefined} onClick={onSelect} className={cls}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export interface SplitViewProps {
  list: ReactNode;
  preview: ReactNode;
  listLabel: string;
  previewLabel: string;
}

/** List (flex 3) and preview (flex 2, sunken). Panes stack below 1000px. */
export function SplitView({ list, preview, listLabel, previewLabel }: SplitViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col min-[1000px]:flex-row">
      <section aria-label={listLabel} className="min-w-0 flex-[3] overflow-y-auto">
        {list}
      </section>
      <aside
        aria-label={previewLabel}
        className="min-w-0 flex-[2] overflow-y-auto border-t border-line bg-sunken min-[1000px]:border-l min-[1000px]:border-t-0"
      >
        {preview}
      </aside>
    </div>
  );
}
