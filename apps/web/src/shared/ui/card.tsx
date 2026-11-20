import type { HTMLAttributes, ReactNode } from 'react';
import { t } from '../i18n';
import { cx } from './cx';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Accent-tinted card (pitch card, highlighted plan). */
  tone?: 'default' | 'accent';
}

export function Card({ tone = 'default', className, ...rest }: CardProps) {
  return (
    <div
      className={cx(
        'rounded-card border p-5',
        tone === 'accent'
          ? 'border-accent-line bg-accent-tint-weak'
          : 'border-line-strong bg-surface',
        className,
      )}
      {...rest}
    />
  );
}

export interface SparklineProps {
  values: number[];
  label: string;
}

export function Sparkline({ values, label }: SparklineProps) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const w = 80;
  const h = 24;
  const points = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * (h - 2) - 1).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg
      role="img"
      aria-label={label}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="text-accent"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface StatTileProps {
  label: string;
  /** Pre-formatted value; null renders "—". */
  value: ReactNode | null;
  /** Previous-period value (pre-formatted) shown under the number. */
  previous?: ReactNode | null;
  /** Lime value (cost per lead). */
  highlight?: boolean;
  sparkline?: number[];
}

export function StatTile({ label, value, previous, highlight, sparkline }: StatTileProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-r border-line px-5 py-4 last:border-r-0">
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{label}</span>
      <div className="flex items-end justify-between gap-3">
        <span
          className={cx(
            'font-mono text-[28px] font-medium leading-tight',
            highlight ? 'text-accent' : 'text-fg',
          )}
        >
          {value ?? '—'}
        </span>
        {sparkline && <Sparkline values={sparkline} label={`${label} trend`} />}
      </div>
      {previous !== undefined && (
        <span className="font-mono text-xs text-faint">
          {previous ?? '—'} {t('common.previousPeriod')}
        </span>
      )}
    </div>
  );
}
