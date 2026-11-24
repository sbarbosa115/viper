/** 130 → `2 h 10 m`, 52 → `52 m`, 1500 → `1 d 1 h`; null → `—`. */
export function formatWait(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ${minutes % 60} m`;
  return `${Math.floor(minutes / 1440)} d ${Math.floor((minutes % 1440) / 60)} h`;
}

export function formatPct(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const time = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `21 Nov, 09:52`. */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** `10:31`. */
export function formatTime(iso: string): string {
  return time.format(new Date(iso));
}
