const stamp = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const clock = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const hm = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

export const formatStamp = (iso: string): string => stamp.format(new Date(iso));
export const formatClock = (iso: string): string => clock.format(new Date(iso));
export const formatHm = (iso: string): string => hm.format(new Date(iso));

/** "Local buyers v3" from the flow key and version. */
export function formatFlow(key: string, version: number): string {
  const words = key.split('-').join(' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} v${version}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

export const formatInt = (n: number): string => new Intl.NumberFormat('en-US').format(n);

/** Microdollars as dollars: 14100000 → "$14.10". */
export const formatUsd = (micros: number, digits = 2): string =>
  `$${(micros / 1_000_000).toFixed(digits)}`;

/** Tool-call credits shown with 3 places (millicredits). */
export const formatMillicredits = (m: number): string => (m / 1000).toFixed(3);

export function formatTokens(units: number): string {
  return units >= 1000 ? `${(units / 1000).toFixed(1)}k` : String(units);
}

/** "12 s ago", "40 s ago", "3 min ago", "2 h ago" from an ISO time. */
export function formatAgo(iso: string, now: Date = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 90) return `${s} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

export const secondsBetween = (from: string, to: string | null, now: Date = new Date()): number =>
  Math.max(0, Math.round(((to ? new Date(to) : now).getTime() - new Date(from).getTime()) / 1000));
