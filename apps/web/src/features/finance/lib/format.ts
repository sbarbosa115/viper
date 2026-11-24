import { HISTORY_START_MONTH, type Month } from '@app/contracts/finance';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const MINUS = '−';

/** $522.75, or −$325.75 for a negative amount. */
export function formatMoney(cents: number): string {
  const v = cents + 0; // turns -0 into 0, which would print as "-$0.00"
  return v < 0 ? `${MINUS}${usd.format(-v / 100)}` : usd.format(v / 100);
}

/** 29.6% (one decimal as the API sends it), or an em dash for null. */
export function formatPct(value: number | null): string {
  if (value === null) return '—';
  return `${value < 0 ? MINUS : ''}${Math.abs(value).toFixed(1)}%`;
}

/** +34.9%, 0.0%, −3.2%. */
export function formatGap(value: number): string {
  if (value === 0) return '0.0%';
  return `${value > 0 ? '+' : MINUS}${Math.abs(value).toFixed(1)}%`;
}

const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `2026-12-18` → "Dec 18, 2026". */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(`${iso}T00:00:00Z`));
}

/** `2026-12-18` → "Dec 18" (no year). */
export function formatDay(iso: string): string {
  return formatDate(iso).replace(/, \d{4}$/, '');
}

const monthFormat = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const shortMonthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

/** `2026-11` → "November 2026". */
export function monthLabel(month: Month): string {
  return monthFormat.format(new Date(`${month}-01T00:00:00Z`));
}

/** `2026-11` → "Nov". */
export function shortMonth(month: Month): string {
  return shortMonthFormat.format(new Date(`${month}-01T00:00:00Z`));
}

export const todayIso = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** The current month in UTC. */
export const currentMonth = (now: Date = new Date()): Month => todayIso(now).slice(0, 7);

/** November 2026 up to `current`, oldest first. */
export function monthRange(current: Month): Month[] {
  const out: Month[] = [];
  let [y, m] = HISTORY_START_MONTH.split('-').map(Number) as [number, number];
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key > current) return out;
    out.push(key);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
}

/** Dollars typed by Staff ("49", "$1,049.50") to cents; NaN when it is not an amount. */
export function dollarsToCents(text: string): number {
  const cleaned = text.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN;
  return Math.round(Number(cleaned) * 100);
}

export const centsToDollars = (cents: number): string => (cents / 100).toFixed(2);

/** Day of month (1-31) of an ISO date. */
export const dayOfMonth = (iso: string): number => Number(iso.slice(8, 10));
