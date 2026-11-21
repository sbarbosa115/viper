/**
 * Support's business time (prd-support section 6, "Business minutes"): Mon–Fri 09:00–17:00 in
 * America/Chicago, computed with `Intl` (no dependency). US public holidays are not excluded in
 * this version. DST-safe: each day's opening and closing instants are resolved with that day's
 * offset.
 */

export const SUPPORT_TIME_ZONE = 'America/Chicago';
const OPEN_HOUR = 9;
const CLOSE_HOUR = 17;
const MINUTE_MS = 60_000;

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: SUPPORT_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

function localParts(
  instantMs: number,
): LocalDate & { hour: number; minute: number; second: number } {
  const parts: Record<string, number> = {};
  for (const p of partsFormat.formatToParts(new Date(instantMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** Chicago wall-clock minus UTC at this instant, in ms (e.g. -5 h in summer). */
function offsetMs(instantMs: number): number {
  const whole = Math.floor(instantMs / 1000) * 1000;
  const p = localParts(whole);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - whole;
}

/** The instant of `hour`:00 Chicago time on that local date. */
function chicagoInstant(date: LocalDate, hour: number): number {
  const asUtc = Date.UTC(date.year, date.month - 1, date.day, hour);
  const first = asUtc - offsetMs(asUtc);
  return asUtc - offsetMs(first);
}

function nextDay(date: LocalDate): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function compareDates(a: LocalDate, b: LocalDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/** Whole minutes inside Mon–Fri 09:00–17:00 America/Chicago between `from` and `to` (0 if to ≤ from). */
export function businessMinutesBetween(from: Date, to: Date): number {
  const start = from.getTime();
  const end = to.getTime();
  if (!(end > start)) return 0;
  let total = 0;
  const last = localParts(end);
  for (let day: LocalDate = localParts(start); compareDates(day, last) <= 0; day = nextDay(day)) {
    const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const open = Math.max(chicagoInstant(day, OPEN_HOUR), start);
    const close = Math.min(chicagoInstant(day, CLOSE_HOUR), end);
    if (close > open) total += close - open;
  }
  return Math.floor(total / MINUTE_MS);
}

/** The Chicago calendar date of an instant, `YYYY-MM-DD` (the once-per-day view audit). */
export function supportDate(at: Date): string {
  const p = localParts(at.getTime());
  return `${String(p.year)}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The median, rounded to a whole number; null for no values. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? (sorted[mid] ?? 0)
      : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return Math.round(value);
}

/** Whole wall-clock minutes from `from` to `to` (never negative). */
export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MINUTE_MS));
}
