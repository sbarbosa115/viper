/**
 * Research flows as data (ADR 0011, ADR 0017): ordered Steps with their allowed Tools, budget
 * shares, time limits and required flag, plus run settings and plan defaults, versioned. Each
 * run snapshots the version it started on (FR-19, FR-37).
 */

export interface RunSettingsValues {
  readonly maxActiveMinutes: number;
  readonly maxTotalHours: number;
  readonly maxAttempts: number;
  /** Wait before attempt n+1 is `retryWaitsMinutes[n-1]`; the last value repeats. */
  readonly retryWaitsMinutes: readonly number[];
  readonly workerStoppedAfterMinutes: number;
  readonly scoreAtBudgetPct: number;
  readonly scoreAtMinutes: number;
}

export interface PlanDefaultValues {
  readonly maxCredits: number;
  readonly maxLeads: number;
  readonly minFitScore: number;
}

export interface FlowStepDefinition {
  readonly key: string;
  readonly name: string;
  /** Tool keys the Step may call (`claude.fast` / `claude.planning` pick the agent's model). */
  readonly tools: readonly string[];
  readonly budgetPct: number;
  readonly timeLimitMinutes: number;
  readonly required: boolean;
}

/** What a run snapshots when it starts (`research_runs.flow_settings`). */
export interface FlowSettingsSnapshot {
  readonly key: string;
  readonly name: string;
  readonly version: number;
  readonly runSettings: RunSettingsValues;
  readonly planDefaults: PlanDefaultValues;
  readonly steps: readonly FlowStepDefinition[];
}

export interface FlowVersion extends FlowSettingsSnapshot {
  readonly id: string;
  readonly isDefault: boolean;
  readonly isTemplate: boolean;
  readonly createdBy: string | null;
  readonly createdAt: Date;
}

/** Platform ceilings (FR-8) a flow must stay within. */
export interface FlowCeilings {
  readonly maxCredits: number;
  readonly maxLeads: number;
  readonly maxActiveMinutes: number;
  readonly maxTotalHours: number;
  readonly maxAttempts: number;
}

export type FlowSettingsInput = Omit<FlowSettingsSnapshot, 'key' | 'version'>;

/**
 * Claude is a Tool per model role (`claude.fast`, `claude.planning`), metered by tokens (FR-24).
 * A Step that lists one uses that model for its agent; others use the planning model (FR-19).
 */
export type ClaudeRole = 'fast' | 'planning';

export function isClaudeTool(toolKey: string): boolean {
  return toolKey.startsWith('claude.');
}

export function claudeTool(role: ClaudeRole): string {
  return `claude.${role}`;
}

/** Steps 2, 8 and 9 of "Local buyers" are always required (FR-19, FR-37). */
export const ALWAYS_REQUIRED_STEPS: readonly string[] = ['maps-places', 'verify', 'score-pitch'];

export const BUDGET_SHARES_MESSAGE = 'Step budget shares must add up to 100%';

/**
 * The shortest worker-stopped timeout (the attempt's lease, FR-36): longer than the longest Tool
 * call with its retry waits (the tools module's LONGEST_TOOL_CALL_MS, 4 min 51 s), so a healthy
 * worker never loses its lease to one slow call even if a heartbeat is missed.
 */
export const MIN_WORKER_STOPPED_MINUTES = 5;

/** The sum of the Steps' time limits, which must fit in the max active time (FR-20, FR-37). */
export function stepTimeTotal(steps: readonly Pick<FlowStepDefinition, 'timeLimitMinutes'>[]) {
  return steps.reduce((sum, s) => sum + s.timeLimitMinutes, 0);
}

function hours(h: number): string {
  return `${h} h`;
}

/**
 * Validates edited flow settings (FR-37). Returns field path → message ("Ceiling 4 h (Settings)"),
 * empty when valid. `current` is the flow's latest version: Steps can't be added, removed or
 * reordered here (the flow editor is a later feature).
 */
export function validateFlowSettings(
  input: FlowSettingsInput,
  ceilings: FlowCeilings,
  current: FlowSettingsSnapshot,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const r = input.runSettings;
  const p = input.planDefaults;
  const over = (path: string, value: number, ceiling: number, shown: string) => {
    if (value > ceiling) errors[path] = `Ceiling ${shown} (Settings)`;
  };
  over(
    'runSettings.maxActiveMinutes',
    r.maxActiveMinutes,
    ceilings.maxActiveMinutes,
    `${ceilings.maxActiveMinutes} min`,
  );
  over(
    'runSettings.maxTotalHours',
    r.maxTotalHours,
    ceilings.maxTotalHours,
    hours(ceilings.maxTotalHours),
  );
  over(
    'runSettings.maxAttempts',
    r.maxAttempts,
    ceilings.maxAttempts,
    String(ceilings.maxAttempts),
  );
  over(
    'planDefaults.maxCredits',
    p.maxCredits,
    ceilings.maxCredits,
    `${ceilings.maxCredits} credits`,
  );
  over('planDefaults.maxLeads', p.maxLeads, ceilings.maxLeads, `${ceilings.maxLeads} leads`);
  if (r.scoreAtMinutes > r.maxActiveMinutes) {
    errors['runSettings.scoreAtMinutes'] = 'Must be at most the max active time';
  }
  if (r.workerStoppedAfterMinutes < MIN_WORKER_STOPPED_MINUTES) {
    errors['runSettings.workerStoppedAfterMinutes'] =
      `At least ${MIN_WORKER_STOPPED_MINUTES} min (the longest Tool call with its retries)`;
  }
  if (r.maxActiveMinutes > r.maxTotalHours * 60) {
    errors['runSettings.maxActiveMinutes'] ??= 'Must be at most the max total time';
  }
  const total = input.steps.reduce((sum, s) => sum + s.budgetPct, 0);
  if (total !== 100) errors.steps = BUDGET_SHARES_MESSAGE;
  const keys = input.steps.map((s) => s.key).join(',');
  if (keys !== current.steps.map((s) => s.key).join(',')) {
    errors.steps ??= 'Steps can only be edited, not added, removed or reordered';
  }
  input.steps.forEach((step, i) => {
    if (ALWAYS_REQUIRED_STEPS.includes(step.key) && !step.required) {
      errors[`steps.${i}.required`] = `${step.name} is always required`;
    }
  });
  return errors;
}

/** Field names that differ between two versions, for the Audit log (FR-37). */
export function changedFlowFields(before: FlowSettingsInput, after: FlowSettingsInput): string[] {
  const changed: string[] = [];
  if (before.name !== after.name) changed.push('name');
  for (const k of Object.keys(after.runSettings) as (keyof RunSettingsValues)[]) {
    if (JSON.stringify(before.runSettings[k]) !== JSON.stringify(after.runSettings[k])) {
      changed.push(`runSettings.${k}`);
    }
  }
  for (const k of Object.keys(after.planDefaults) as (keyof PlanDefaultValues)[]) {
    if (before.planDefaults[k] !== after.planDefaults[k]) changed.push(`planDefaults.${k}`);
  }
  after.steps.forEach((step, i) => {
    const prev = before.steps[i];
    for (const k of ['name', 'tools', 'budgetPct', 'timeLimitMinutes', 'required'] as const) {
      if (JSON.stringify(prev?.[k]) !== JSON.stringify(step[k])) {
        changed.push(`steps.${step.key}.${k}`);
      }
    }
  });
  return changed;
}

/** The wait before the attempt after attempt `n` (FR-36: 1, 5, 15 min; the last value repeats). */
export function retryWaitMinutes(settings: RunSettingsValues, attemptN: number): number {
  const waits = settings.retryWaitsMinutes;
  return waits[Math.min(attemptN - 1, waits.length - 1)] ?? 0;
}
