const stamp = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "Nov 19, 15:42" in the viewer's time zone. */
export const formatStamp = (iso: string): string => stamp.format(new Date(iso));

/** "run 0193f4c2", or just the type when there is no id. */
export function formatTarget(type: string, id: string | null): string {
  return id ? `${type} ${id.slice(0, 8)}` : type;
}
