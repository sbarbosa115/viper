import { ValidationError } from '../../../shared/domain/errors.js';

export type DashboardPeriod = '7d' | '30d' | '90d';

/** Half-open time range [from, to). */
export interface TimeWindow {
  readonly from: Date;
  readonly to: Date;
}

export interface PeriodWindows {
  readonly period: DashboardPeriod;
  readonly days: number;
  /** The last `days` UTC days, today included. */
  readonly current: TimeWindow;
  /** The `days` UTC days before the current window. */
  readonly previous: TimeWindow;
}

export const DAY_MS = 86_400_000;

const PERIOD_DAYS: Readonly<Record<DashboardPeriod, number>> = { '7d': 7, '30d': 30, '90d': 90 };

/** UTC midnight of the day `at` falls in. */
export function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/**
 * FR-30: the period ends at the end of today (UTC) and covers whole days, so "by day" charts have
 * exactly `days` bars; the previous period is the same length right before it.
 */
export function periodWindows(period: DashboardPeriod, now: Date): PeriodWindows {
  const days = PERIOD_DAYS[period];
  if (!days) throw new ValidationError('Unknown period', { period });
  const to = new Date(startOfUtcDay(now).getTime() + DAY_MS);
  const from = new Date(to.getTime() - days * DAY_MS);
  const previousFrom = new Date(from.getTime() - days * DAY_MS);
  return { period, days, current: { from, to }, previous: { from: previousFrom, to: from } };
}

export function within(at: Date | null, window: TimeWindow): boolean {
  return at !== null && at >= window.from && at < window.to;
}

/** `YYYY-MM-DD` (UTC) of each day in the window, oldest first. */
export function daysIn(window: TimeWindow): string[] {
  const days: string[] = [];
  for (let t = startOfUtcDay(window.from).getTime(); t < window.to.getTime(); t += DAY_MS) {
    days.push(isoDay(new Date(t)));
  }
  return days;
}

export function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}
