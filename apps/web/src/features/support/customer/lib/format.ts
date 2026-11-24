const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const time = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** `10:42` today, else `21 Nov`. */
export function formatUpdated(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return sameDay(date, now) ? time.format(date) : day.format(date);
}

/** `21 Nov` */
export const formatDay = (iso: string): string => day.format(new Date(iso));

/** `10:42` */
export const formatTime = (iso: string): string => time.format(new Date(iso));

/** `21 Nov 09:52` */
export const formatDateTime = (iso: string): string => `${formatDay(iso)} ${formatTime(iso)}`;

/** A message's time: `10:42` today, else `21 Nov 09:52`. */
export function formatStamp(iso: string, now: Date = new Date()): string {
  return sameDay(new Date(iso), now) ? formatTime(iso) : formatDateTime(iso);
}
