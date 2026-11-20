/**
 * Metric definitions for the Staff dashboard (FR-30). Pure functions over facts the other
 * contexts report; `null` means "no data" (shown as "—").
 */

/** G-5: a run "finishes within limits" when it completes within 60 minutes and its budget. */
export const WITHIN_LIMITS_SECONDS = 60 * 60;
/** One credit is worth $0.01 at list price = 10,000 microdollars (FR-13). */
export const MICROS_PER_CREDIT = 10_000;
export const MICROS_PER_CENT = 10_000;

export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** part ÷ whole as a percentage (1 decimal), or null when there is nothing to divide by. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? round((part / whole) * 100, 1) : null;
}

export function ratio(part: number, whole: number, decimals: number): number | null {
  return whole > 0 ? round(part / whole, decimals) : null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? null)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const sum = (values: readonly number[]) => values.reduce((s, v) => s + v, 0);

// Runs -------------------------------------------------------------------------------------------

export type RunStatus = 'queued' | 'running' | 'retrying' | 'completed' | 'failed' | 'cancelled';

/** One Research run started in the period, as research reports it. */
export interface RunFact {
  readonly runId: string;
  readonly businessId: string;
  readonly status: RunStatus;
  readonly queuedAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly creditsSpent: number;
  /** The Plan's max credits when the run started (its budget). */
  readonly maxCredits: number;
  readonly providerCostMicros: number;
  readonly leadsDelivered: number;
  /** The Plan's Ideal Customer Profile had been edited when the run started (G-4). */
  readonly icpEdited: boolean;
  readonly failureCode: string | null;
}

const isTerminal = (r: RunFact) =>
  r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled';
/** Completed or failed: cancelled runs are the Owner's choice, not a reliability signal. */
const isFinished = (r: RunFact) => r.status === 'completed' || r.status === 'failed';

export function durationSeconds(r: RunFact): number | null {
  if (!r.startedAt || !r.finishedAt) return null;
  return Math.max(0, Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000));
}

export function isWithinLimits(r: RunFact): boolean {
  const duration = durationSeconds(r);
  return (
    r.status === 'completed' &&
    duration !== null &&
    duration <= WITHIN_LIMITS_SECONDS &&
    r.creditsSpent <= r.maxCredits
  );
}

export interface RunMetrics {
  started: number;
  /** completed ÷ (completed + failed). */
  completedPct: number | null;
  /** completed within 60 min and budget ÷ (completed + failed) (G-5). */
  withinLimitsPct: number | null;
  /** Of completed runs, start to finish. */
  medianDurationS: number | null;
  /** Credits spent per finished (completed, failed or cancelled) run. */
  avgCredits: number | null;
  /** Of finished runs: provider cost ÷ Leads delivered, in cents. */
  providerCostPerLeadCents: number | null;
  creditsPerLead: number | null;
  /** G-3: 1 − provider cost ÷ (credits spent × $0.01). */
  grossMarginPct: number | null;
  /** G-4: runs started from Plans whose ICP was never edited ÷ runs started. */
  noIcpEditPct: number | null;
}

export function runMetrics(runs: readonly RunFact[]): RunMetrics {
  const finished = runs.filter(isFinished);
  const completed = finished.filter((r) => r.status === 'completed');
  const terminal = runs.filter(isTerminal);
  const costMicros = sum(terminal.map((r) => r.providerCostMicros));
  const creditsSpent = sum(terminal.map((r) => r.creditsSpent));
  const leads = sum(terminal.map((r) => r.leadsDelivered));
  const durations = completed.map(durationSeconds).filter((d): d is number => d !== null);
  const medianDuration = median(durations);
  return {
    started: runs.length,
    completedPct: percent(completed.length, finished.length),
    withinLimitsPct: percent(finished.filter(isWithinLimits).length, finished.length),
    medianDurationS: medianDuration === null ? null : Math.round(medianDuration),
    avgCredits: ratio(creditsSpent, terminal.length, 1),
    providerCostPerLeadCents: ratio(costMicros / MICROS_PER_CENT, leads, 2),
    creditsPerLead: ratio(creditsSpent, leads, 1),
    grossMarginPct:
      creditsSpent > 0
        ? round((1 - costMicros / (creditsSpent * MICROS_PER_CREDIT)) * 100, 1)
        : null,
    noIcpEditPct: percent(runs.filter((r) => !r.icpEdited).length, runs.length),
  };
}

/** Businesses with at least one run in the period. */
export function activeBusinessIds(runs: readonly RunFact[]): Set<string> {
  return new Set(runs.map((r) => r.businessId));
}

/** Failed runs, newest first. */
export function failedRuns(runs: readonly RunFact[], limit: number): RunFact[] {
  const at = (r: RunFact) => (r.finishedAt ?? r.queuedAt).getTime();
  return runs
    .filter((r) => r.status === 'failed')
    .sort((a, b) => at(b) - at(a) || b.runId.localeCompare(a.runId))
    .slice(0, limit);
}

/** Credits spent per Business (only those `include` accepts), most first; ties by id. */
export function topBusinessesByCredits(
  runs: readonly RunFact[],
  include: (businessId: string) => boolean,
  limit: number,
): { businessId: string; creditsSpent: number }[] {
  const totals = new Map<string, number>();
  for (const r of runs) {
    if (!include(r.businessId)) continue;
    totals.set(r.businessId, (totals.get(r.businessId) ?? 0) + r.creditsSpent);
  }
  return [...totals]
    .filter(([, credits]) => credits > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, limit)
    .map(([businessId, creditsSpent]) => ({ businessId, creditsSpent }));
}

/** North star: Good leads ÷ active Businesses ÷ weeks in the period (2 decimals). */
export function goodLeadsPerActiveBusinessPerWeek(
  goodLeads: number,
  activeBusinesses: number,
  days: number,
): number | null {
  if (activeBusinesses === 0 || days <= 0) return null;
  return round(goodLeads / activeBusinesses / (days / 7), 2);
}

// Providers --------------------------------------------------------------------------------------

/** Tool calls of one Tool in the period, as the tools module reports them. */
export interface ToolSpend {
  readonly toolKey: string;
  readonly providerCostMicros: number;
  /** ok + error calls (reused and skipped calls excluded). */
  readonly calls: number;
  readonly errors: number;
}

export interface ProviderRow {
  toolKey: string;
  spendCents: number;
  errorRatePct: number | null;
}

/** Spend by Tool, most first; ties by key. */
export function providerRows(spend: readonly ToolSpend[]): ProviderRow[] {
  return [...spend]
    .sort(
      (a, b) => b.providerCostMicros - a.providerCostMicros || a.toolKey.localeCompare(b.toolKey),
    )
    .map((s) => ({
      toolKey: s.toolKey,
      spendCents: round(s.providerCostMicros / MICROS_PER_CENT, 2),
      errorRatePct: percent(s.errors, s.calls),
    }));
}
