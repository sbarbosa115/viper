/** CSV export rules (FR-28). */

/**
 * CSV injection guard: a value starting with `=`, `+`, `-` or `@` (or a tab or carriage return,
 * which spreadsheets also treat as formula starts) gets a leading `'`.
 */
export function csvSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** A Plan name as a file-name slug: lowercase ASCII words joined by dashes (≤ 60), or `plan`. */
export function slugOf(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'plan';
}

/** `llyner-leads-<plan-slug>-<yyyy-mm-dd>.csv`, dated in UTC. */
export function csvFileName(planName: string, now: Date): string {
  return `llyner-leads-${slugOf(planName)}-${now.toISOString().slice(0, 10)}.csv`;
}
