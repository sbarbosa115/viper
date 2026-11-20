import type { FlowStepDefinition, RunSettingsValues } from './flow.js';
import type { RunStatus } from './run.js';

/**
 * Guardrails enforced by the runner, not the model (ADR 0008, FR-20). Pure functions over the
 * run's flow-settings snapshot.
 */

/**
 * The millicredits Step `index` may still spend: its share of max credits plus whatever earlier
 * Steps left unused (FR-19: unused budget share carries to the next Step).
 */
export function stepAllowanceMillicredits(props: {
  steps: readonly FlowStepDefinition[];
  index: number;
  maxCredits: number;
  /** Spent by Steps before `index`. */
  spentBefore: number;
  /** Spent by this Step so far. */
  spentInStep: number;
}): number {
  const pct = props.steps.slice(0, props.index + 1).reduce((sum, s) => sum + s.budgetPct, 0);
  const cumulative = Math.floor((pct * props.maxCredits * 1000) / 100);
  return cumulative - props.spentBefore - props.spentInStep;
}

export type CollectionStop = 'budget' | 'time' | null;

/**
 * FR-20: collection (Steps 2–7) stops when total spend reaches `scoreAtBudgetPct` of max credits
 * or `scoreAtMinutes` of active time have passed; the run goes on to Verify, Score and Deliver.
 */
export function collectionStop(props: {
  settings: RunSettingsValues;
  spentMillicredits: number;
  maxCredits: number;
  activeSeconds: number;
}): CollectionStop {
  const budgetLine = (props.settings.scoreAtBudgetPct * props.maxCredits * 1000) / 100;
  if (props.spentMillicredits >= budgetLine) return 'budget';
  if (props.activeSeconds >= props.settings.scoreAtMinutes * 60) return 'time';
  return null;
}

/** FR-20 hard stop: the flow's max active time (the run fails with TIME_LIMIT). */
export function activeTimeUsed(settings: RunSettingsValues, activeSeconds: number): boolean {
  return activeSeconds >= settings.maxActiveMinutes * 60;
}

/** A Step stops when its own time limit is used (FR-20). */
export function stepTimeUsed(step: FlowStepDefinition, stepSeconds: number): boolean {
  return stepSeconds >= step.timeLimitMinutes * 60;
}

/**
 * FR-38: the customer sees "Taking a little longer…" while a retry waits, during any attempt
 * after the first, or once active time passes the flow's max active time.
 */
export function isTakingLonger(props: {
  status: RunStatus;
  attempts: number;
  activeSeconds: number;
  settings: RunSettingsValues;
}): boolean {
  if (props.status === 'retrying') return true;
  if (props.status !== 'running') return false;
  return props.attempts >= 2 || activeTimeUsed(props.settings, props.activeSeconds);
}
