import { copy, fill } from '../copy';

/** "18 min", "1 h 12 min", "Just started". */
export function formatElapsed(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return 'Under a minute';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export const leadsLabel = (n: number) => (n === 1 ? copy.leadOne : fill(copy.leadMany, { n }));

export const formatCostPerLead = (value: number | null) =>
  value === null ? '—' : `${Number(value.toFixed(1))}`;
