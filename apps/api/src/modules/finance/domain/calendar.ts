/**
 * Calendar days, UTC months and integer rounding for finance (prd-expenses section 6 conventions).
 * A day is `YYYY-MM-DD` and a month `YYYY-MM`; both compare correctly as strings.
 */

/** A calendar day, `YYYY-MM-DD`. */
export type CalendarDay = string;
/** A UTC calendar month, `YYYY-MM`. */
export type MonthKey = string;

/** The first month that can be viewed or written. */
export const HISTORY_START_MONTH: MonthKey = '2026-11';
export const HISTORY_START_DAY: CalendarDay = '2026-11-01';

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function parts(month: MonthKey): { year: number; month: number } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { year: y, month: m };
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInMonth(month: MonthKey): number {
  const { year, month: m } = parts(month);
  return m === 2 && isLeapYear(year) ? 29 : (DAYS[m - 1] ?? 31);
}

export function monthOf(day: CalendarDay): MonthKey {
  return day.slice(0, 7);
}

/** The UTC month of an instant. */
export function monthOfInstant(at: Date): MonthKey {
  return at.toISOString().slice(0, 7);
}

/** The UTC day of an instant. */
export function dayOfInstant(at: Date): CalendarDay {
  return at.toISOString().slice(0, 10);
}

export function addMonths(month: MonthKey, n: number): MonthKey {
  const { year, month: m } = parts(month);
  const index = year * 12 + (m - 1) + n;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`;
}

/** Whole months from `from` to `to` (0 when equal). */
export function monthsBetween(from: MonthKey, to: MonthKey): number {
  const a = parts(from);
  const b = parts(to);
  return b.year * 12 + b.month - (a.year * 12 + a.month);
}

/** `from`..`to` inclusive, ascending. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const n = monthsBetween(from, to);
  return Array.from({ length: Math.max(0, n + 1) }, (_, i) => addMonths(from, i));
}

export function firstDayOf(month: MonthKey): CalendarDay {
  return `${month}-01`;
}

export function lastDayOf(month: MonthKey): CalendarDay {
  return `${month}-${pad(daysInMonth(month))}`;
}

/** The day `dayOfMonth` in `month`, clamped to its last day (the 31st → Feb 28). */
export function clampedDay(month: MonthKey, dayOfMonth: number): CalendarDay {
  return `${month}-${pad(Math.min(dayOfMonth, daysInMonth(month)))}`;
}

export function dayOfMonth(day: CalendarDay): number {
  return Number(day.slice(8, 10));
}

export function monthNumber(day: string): number {
  return Number(day.slice(5, 7));
}

/** Days after `day` (negative goes back); pure arithmetic on UTC midnight. */
export function addDays(day: CalendarDay, n: number): CalendarDay {
  const ms =
    Date.UTC(Number(day.slice(0, 4)), monthNumber(day) - 1, dayOfMonth(day)) + n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** The month's instants `[start, end)` in UTC. */
export function monthBounds(month: MonthKey): { start: Date; end: Date } {
  return {
    start: new Date(`${firstDayOf(month)}T00:00:00.000Z`),
    end: new Date(`${firstDayOf(addMonths(month, 1))}T00:00:00.000Z`),
  };
}

export const minDay = (a: CalendarDay, b: CalendarDay): CalendarDay => (a < b ? a : b);

/**
 * `numerator / denominator` rounded half up (half away from zero for negatives), in integers.
 * `denominator` must be positive.
 */
export function roundHalfUp(numerator: number, denominator: number): number {
  const sign = numerator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  const result = Math.floor((2 * n + denominator) / (2 * denominator));
  return result === 0 ? 0 : sign * result;
}

/** `part / whole × 100` with one decimal, rounded half up. `whole` must not be 0. */
export function pctOneDecimal(part: number, whole: number): number {
  const sign = whole < 0 ? -1 : 1;
  return roundHalfUp(sign * part * 1000, Math.abs(whole)) / 10;
}

/** `part / whole × 100` rounded to a whole number. `whole` must be positive. */
export function pctWhole(part: number, whole: number): number {
  return roundHalfUp(part * 100, whole);
}

export const sum = (values: readonly number[]): number => values.reduce((s, v) => s + v, 0);
