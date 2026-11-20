import type { Metric, MoneyMetric } from '@app/contracts/reporting';

const int = new Intl.NumberFormat('en-US');
const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const stamp = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export const formatShortDate = (iso: string): string => day.format(new Date(iso));
export const formatStamp = (iso: string): string => stamp.format(new Date(iso));

export const formatCount = (n: number | null): string | null => (n === null ? null : int.format(n));
export const formatPct = (n: number | null): string | null =>
  n === null ? null : `${Math.round(n)}%`;
export const formatDecimal = (n: number | null): string | null =>
  n === null ? null : (Math.round(n * 10) / 10).toString();

export function formatUsdCents(cents: number | null): string | null {
  if (cents === null) return null;
  const whole = Number.isInteger(cents / 100);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 3,
  }).format(cents / 100);
}

export function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

/** A metric formatted for a StatTile: the value and the previous period, null → "—". */
export function tile<T extends Metric>(m: T, fmt: (n: number | null) => string | null) {
  return { value: fmt(m.value), previous: fmt(m.previous) };
}

export function moneyTile(m: MoneyMetric) {
  return {
    value: formatUsdCents(m.value?.cents ?? null),
    previous: formatUsdCents(m.previous?.cents ?? null),
  };
}
