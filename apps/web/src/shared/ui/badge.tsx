import type { ReactNode } from 'react';
import { cx } from './cx';

export type StatusKind = 'ok' | 'running' | 'retrying' | 'failed' | 'cancelled' | 'new' | 'staff';

const status: Record<StatusKind, { word: string; symbol: string; tone: string }> = {
  ok: { word: 'READY', symbol: '●', tone: 'text-accent' },
  running: { word: 'RUNNING', symbol: '◐', tone: 'text-accent' },
  retrying: { word: 'RETRYING', symbol: '↻', tone: 'text-warn' },
  failed: { word: 'FAILED', symbol: '✕', tone: 'text-danger' },
  cancelled: { word: 'CANCELLED', symbol: '○', tone: 'text-muted' },
  new: { word: 'NEW', symbol: '＋', tone: 'text-accent' },
  staff: { word: 'STAFF', symbol: '◆', tone: 'text-warn' },
};

export interface BadgeProps {
  tone?: 'neutral' | 'accent' | 'warn';
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex h-[22px] items-center rounded-tag border px-2 font-mono text-[11px] font-medium uppercase tracking-wider',
        tone === 'accent' && 'border-accent-line bg-accent-tint text-accent',
        tone === 'warn' && 'border-warn/40 bg-warn/10 text-warn',
        tone === 'neutral' && 'border-line-control text-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface StatusPillProps {
  kind: StatusKind;
  /** Override the default word (for example "DONE"). */
  label?: string;
}

/** Status is always a word plus a symbol, never colour alone. */
export function StatusPill({ kind, label }: StatusPillProps) {
  const s = status[kind];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 font-mono text-xs font-medium uppercase tracking-wider',
        s.tone,
      )}
    >
      <span aria-hidden="true">{s.symbol}</span>
      {label ?? s.word}
    </span>
  );
}

export interface ScoreBadgeProps {
  score: number;
  /** "tile" is the 44px square in lists, "pill" is inline. */
  variant?: 'tile' | 'pill';
}

export function ScoreBadge({ score, variant = 'tile' }: ScoreBadgeProps) {
  const high = score >= 80;
  const mid = score >= 60 && score < 80;
  return (
    <span
      aria-label={`Fit score ${score}`}
      className={cx(
        'inline-grid place-items-center font-mono font-medium',
        variant === 'tile' ? 'size-11 rounded-row text-base' : 'h-6 rounded-full px-2.5 text-xs',
        high && 'bg-accent-tint text-accent',
        mid && 'bg-raised text-fg-2',
        !high && !mid && 'bg-surface text-muted',
      )}
    >
      {score}
    </span>
  );
}
