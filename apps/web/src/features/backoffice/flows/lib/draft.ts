import { flowInput, type Flow, type FlowInput } from '@app/contracts/research';
import type { ZodIssue } from 'zod';
import { copy, fill } from '../copy';

/** Steps 2, 8 and 9 of Local buyers (FR-37): always required, never switched off. */
export const ALWAYS_REQUIRED = new Set(['maps-places', 'verify', 'score-pitch']);

export interface Draft {
  maxActiveMinutes: string;
  maxTotalHours: string;
  maxAttempts: string;
  retryWaits: string;
  workerStoppedAfterMinutes: string;
  scoreAtBudgetPct: string;
  scoreAtMinutes: string;
  maxCredits: string;
  maxLeads: string;
  minFitScore: string;
  steps: { budgetPct: string; timeLimitMinutes: string; required: boolean }[];
}

export const toDraft = (f: Flow): Draft => ({
  maxActiveMinutes: String(f.runSettings.maxActiveMinutes),
  maxTotalHours: String(f.runSettings.maxTotalHours),
  maxAttempts: String(f.runSettings.maxAttempts),
  retryWaits: f.runSettings.retryWaitsMinutes.join(', '),
  workerStoppedAfterMinutes: String(f.runSettings.workerStoppedAfterMinutes),
  scoreAtBudgetPct: String(f.runSettings.scoreAtBudgetPct),
  scoreAtMinutes: String(f.runSettings.scoreAtMinutes),
  maxCredits: String(f.planDefaults.maxCredits),
  maxLeads: String(f.planDefaults.maxLeads),
  minFitScore: String(f.planDefaults.minFitScore),
  steps: f.steps.map((s) => ({
    budgetPct: String(s.budgetPct),
    timeLimitMinutes: String(s.timeLimitMinutes),
    required: s.required,
  })),
});

export type Errors = Record<string, string>;

const num = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text));

function parseWaits(text: string): number[] {
  const parts = text.split(',').map((p) => p.trim());
  return parts.every((p) => /^\d+$/.test(p)) ? parts.map(Number) : [Number.NaN];
}

/** The request body for a draft: numbers parsed, still unvalidated. */
export function toInput(flow: Flow, d: Draft): unknown {
  return {
    key: flow.key,
    name: flow.name,
    runSettings: {
      maxActiveMinutes: num(d.maxActiveMinutes),
      maxTotalHours: num(d.maxTotalHours),
      maxAttempts: num(d.maxAttempts),
      retryWaitsMinutes: parseWaits(d.retryWaits),
      workerStoppedAfterMinutes: num(d.workerStoppedAfterMinutes),
      scoreAtBudgetPct: num(d.scoreAtBudgetPct),
      scoreAtMinutes: num(d.scoreAtMinutes),
    },
    planDefaults: {
      maxCredits: num(d.maxCredits),
      maxLeads: num(d.maxLeads),
      minFitScore: num(d.minFitScore),
    },
    steps: flow.steps.map((s, i) => ({
      key: s.key,
      name: s.name,
      tools: s.tools,
      budgetPct: num(d.steps[i]!.budgetPct),
      timeLimitMinutes: num(d.steps[i]!.timeLimitMinutes),
      required: ALWAYS_REQUIRED.has(s.key) ? true : d.steps[i]!.required,
    })),
  };
}

export const budgetTotal = (d: Draft): number =>
  d.steps.reduce((sum, s) => sum + (Number.isFinite(num(s.budgetPct)) ? num(s.budgetPct) : 0), 0);

export const timeTotal = (d: Draft): number =>
  d.steps.reduce(
    (sum, s) => sum + (Number.isFinite(num(s.timeLimitMinutes)) ? num(s.timeLimitMinutes) : 0),
    0,
  );

const ceilingChecks = [
  {
    path: 'runSettings.maxActiveMinutes',
    field: 'maxActiveMinutes',
    text: (n: number) => `${n} min`,
  },
  { path: 'runSettings.maxTotalHours', field: 'maxTotalHours', text: (n: number) => `${n} h` },
  { path: 'runSettings.maxAttempts', field: 'maxAttempts', text: (n: number) => String(n) },
  { path: 'planDefaults.maxCredits', field: 'maxCredits', text: (n: number) => String(n) },
  { path: 'planDefaults.maxLeads', field: 'maxLeads', text: (n: number) => String(n) },
] as const;

function valueAt(input: FlowInput, path: string): number {
  const [group, name] = path.split('.') as ['runSettings' | 'planDefaults', string];
  return (input[group] as unknown as Record<string, number>)[name]!;
}

function messageFor(issue: ZodIssue, path: string): string {
  if (issue.code === 'custom') return issue.message;
  if (path.startsWith('runSettings.retryWaitsMinutes')) return copy.invalidWaits;
  if (issue.code === 'invalid_type') {
    return path === 'runSettings.maxTotalHours' ? copy.invalidDecimal : copy.invalidNumber;
  }
  if (issue.code === 'too_small') return fill(copy.atLeast, { n: String(issue.minimum) });
  if (issue.code === 'too_big') return fill(copy.atMost, { n: String(issue.maximum) });
  return issue.message;
}

/** Client-side validation: the contract schema, then the ceilings and the step time limits. */
export function validate(flow: Flow, d: Draft): { input: FlowInput | null; errors: Errors } {
  const parsed = flowInput.safeParse(toInput(flow, d));
  const errors: Errors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      errors[path] ??= messageFor(issue, path);
    }
    return { input: null, errors };
  }
  const input = parsed.data;
  for (const c of ceilingChecks) {
    const ceiling = flow.ceilings[c.field];
    if (valueAt(input, c.path) > ceiling) {
      errors[c.path] = fill(copy.overCeiling, { ceiling: c.text(ceiling) });
    }
  }
  const time = input.steps.reduce((sum, s) => sum + s.timeLimitMinutes, 0);
  if (time > input.runSettings.maxActiveMinutes) {
    errors['steps.time'] = fill(copy.timeOver, { n: time });
  }
  return { input: Object.keys(errors).length > 0 ? null : input, errors };
}
