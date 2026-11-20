import { copy, fill } from '../copy';

const int = new Intl.NumberFormat('en-US');
const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit' });

export const formatCredits = (n: number): string => int.format(n);
export const formatDay = (iso: string): string => day.format(new Date(iso));

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "today", "1 d ago", "9 d ago"; "—" when never active. */
export function formatLastActive(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return copy.none;
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000);
  return days <= 0 ? copy.today : fill(copy.daysAgo, { n: String(days) });
}
