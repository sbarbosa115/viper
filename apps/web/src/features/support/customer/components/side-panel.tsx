import type { ReactNode } from 'react';
import { cx } from '../../../../shared/ui';

/** The right column on desktop (HOW SUPPORT WORKS, DETAILS, WE'LL ATTACH). */
export function SidePanel({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside
      aria-label={title}
      className={cx(
        'flex min-w-0 flex-col gap-4 border-t border-line bg-sunken p-4 md:p-7 min-[1000px]:border-l min-[1000px]:border-t-0',
        className,
      )}
    >
      <h2 className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{title}</h2>
      {children}
    </aside>
  );
}

export function Facts({ children }: { children: ReactNode }) {
  return <dl className="m-0 flex flex-col">{children}</dl>;
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-2.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="m-0 text-right text-fg-2">{children}</dd>
    </div>
  );
}
