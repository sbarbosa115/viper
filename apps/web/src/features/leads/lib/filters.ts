import { leadFilters, type LeadFilters } from '@app/contracts/leads';

export type { LeadFilters };

/** Filters as the UI edits them: unset values may be `undefined`; `sort` defaults to score. */
export type FilterValues = { [K in keyof LeadFilters]?: LeadFilters[K] | undefined };

/** Reads the filters from the page's search params; anything invalid falls back to "no filter". */
export function parseFilters(params: URLSearchParams): LeadFilters {
  const raw: Record<string, string> = {};
  for (const key of ['runId', 'minScore', 'feedback', 'q', 'sort']) {
    const value = params.get(key);
    if (value) raw[key] = value;
  }
  const parsed = leadFilters.safeParse(raw);
  return parsed.success ? parsed.data : leadFilters.parse({});
}

/** The filters as a query string for the API and the CSV link (always carries the sort). */
export function filtersToQuery(filters: FilterValues): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.runId) query.set('runId', filters.runId);
  if (filters.minScore !== undefined) query.set('minScore', String(filters.minScore));
  if (filters.feedback) query.set('feedback', filters.feedback);
  if (filters.q) query.set('q', filters.q);
  query.set('sort', filters.sort ?? 'score');
  return query;
}

/** Filters that narrow the list (the sort does not). */
export const hasActiveFilters = (f: FilterValues): boolean =>
  Boolean(f.runId) || f.minScore !== undefined || Boolean(f.feedback) || Boolean(f.q);

/** The URL search params for the page: defaults are left out. */
export function filtersToSearch(filters: FilterValues): URLSearchParams {
  const query = filtersToQuery(filters);
  if ((filters.sort ?? 'score') === 'score') query.delete('sort');
  return query;
}
