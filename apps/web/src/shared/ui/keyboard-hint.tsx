import { cx } from './cx';

export function KeyboardHint({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-tag border border-line-control px-1.5 font-mono text-[11px] text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
