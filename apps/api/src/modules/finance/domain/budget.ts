import { pctWhole } from './calendar.js';

export type BudgetStatus = 'under' | 'near' | 'over';
export type BudgetThreshold = 80 | 100;

export const BUDGET_THRESHOLDS: readonly BudgetThreshold[] = [80, 100];

export interface BudgetProgress {
  readonly budgetCents: number;
  readonly spentCents: number;
  /** spent / budget × 100 rounded; null when the Budget is 0. */
  readonly pct: number | null;
  readonly status: BudgetStatus;
}

/**
 * FR-11: `under` below 80%, `near` 80–99%, `over` from 100%. A Budget of 0 is `over` as soon as
 * anything is spent. Thresholds compare the exact ratio, not the rounded pct (99.6% is `near`).
 */
export function budgetProgress(spentCents: number, budgetCents: number): BudgetProgress {
  if (budgetCents <= 0) {
    return { budgetCents, spentCents, pct: null, status: spentCents > 0 ? 'over' : 'under' };
  }
  const status: BudgetStatus =
    spentCents >= budgetCents ? 'over' : spentCents * 100 >= budgetCents * 80 ? 'near' : 'under';
  return { budgetCents, spentCents, pct: pctWhole(spentCents, budgetCents), status };
}

/** The thresholds month-to-date spend has reached (FR-12 uses this to decide alerts). */
export function thresholdsReached(spentCents: number, budgetCents: number): BudgetThreshold[] {
  if (budgetCents <= 0) return spentCents > 0 ? [80, 100] : [];
  return BUDGET_THRESHOLDS.filter((t) => spentCents * 100 >= budgetCents * t);
}
