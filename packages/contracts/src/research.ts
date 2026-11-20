import { z } from 'zod';
import { defineContract, err, id, idParams, isoDateTime, listQuery, page } from './common.js';
import { runFailureCode } from './errors.js';
import { ceilings } from './platform.js';

// Runs (FR-18 to FR-22, FR-36, FR-38) --------------------------------------------------------------

export const runStatus = z.enum([
  'queued',
  'running',
  'retrying',
  'completed',
  'failed',
  'cancelled',
]);
export type RunStatus = z.infer<typeof runStatus>;

export const stepStatus = z.enum(['pending', 'running', 'done', 'skipped', 'failed']);
export type StepStatus = z.infer<typeof stepStatus>;

/** The key of the default Flow template. */
export const LOCAL_BUYERS_FLOW_KEY = 'local-buyers';

/** Step keys of the "Local buyers" flow, in order (FR-19). */
export const localBuyersStepKeys = [
  'search-terms',
  'maps-places',
  'merge',
  'pre-score',
  'websites',
  'socials-reviews',
  'contacts',
  'verify',
  'score-pitch',
  'deliver',
] as const;

export const stepKey = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, digits and dashes')
  .max(64);

export const runStep = z.object({ key: stepKey, name: z.string(), status: stepStatus });
export type RunStep = z.infer<typeof runStep>;

/**
 * What customers see of a run. `takingLonger` drives the FR-38 message; customers never see
 * attempt numbers, but `attempt` is part of the shape for Staff screens and the Plan page.
 */
export const runSummary = z.object({
  id,
  planId: id,
  flow: z.object({ key: z.string(), version: z.int().positive() }),
  attempt: z.object({ current: z.int().nonnegative(), max: z.int().positive() }),
  takingLonger: z.boolean(),
  status: runStatus,
  steps: z.array(runStep),
  /** Null while queued. */
  startedAt: isoDateTime.nullable(),
  finishedAt: isoDateTime.nullable(),
  creditsReserved: z.int().nonnegative(),
  creditsSpent: z.int().nonnegative(),
  leadsDelivered: z.int().nonnegative(),
  costPerLead: z.number().nonnegative().nullable(),
  budgetReached: z.boolean(),
  timeReached: z.boolean(),
  failureReason: runFailureCode.nullable(),
});
export type RunSummary = z.infer<typeof runSummary>;

export const startedBy = z.enum(['owner', 'staff']);

/** A run in the Staff runs monitor (FR-32). */
export const staffRunSummary = runSummary.extend({
  business: z.object({ id, name: z.string() }),
  planName: z.string(),
  startedBy,
  durationS: z.int().nonnegative().nullable(),
  providerCostMicros: z.int().nonnegative(),
  /** When the next automatic attempt starts (status `retrying`), else null. */
  nextAttemptAt: isoDateTime.nullable(),
  /** The step the next attempt resumes from ("from step k"), else null. */
  resumeFromStep: stepKey.nullable(),
});
export type StaffRunSummary = z.infer<typeof staffRunSummary>;

export const toolCallStatus = z.enum(['ok', 'error', 'skipped']);

export const staffToolCall = z.object({
  id,
  toolKey: z.string(),
  units: z.int().nonnegative(),
  millicredits: z.int().nonnegative(),
  providerCostMicros: z.int().nonnegative(),
  status: toolCallStatus,
  error: z.string().nullable(),
  durationMs: z.int().nonnegative(),
  createdAt: isoDateTime,
  attempt: z.int().positive().nullable(),
  /** Answered from storage on a later attempt: not called again, 0 credits. */
  reused: z.boolean(),
});
export type StaffToolCall = z.infer<typeof staffToolCall>;

export const attemptOutcome = z.enum([
  'running',
  'completed',
  'retryable_error',
  'final_error',
  'worker_stopped',
  'cancelled',
]);
export type AttemptOutcome = z.infer<typeof attemptOutcome>;

/** A position inside a run: the step and how many of its items were done (0 = step start). */
export const runPosition = z.object({ stepKey, item: z.int().nonnegative() });

/** What one attempt leaves for the next (FR-36, ADR 0017). */
export const handoff = z.object({
  stepKey,
  itemsDone: z.int().nonnegative(),
  itemsLeft: z.int().nonnegative(),
  notes: z.string().max(2_000),
  lastError: z.string().nullable(),
  creditsLeft: z.int(),
  activeSecondsLeft: z.int(),
});
export type Handoff = z.infer<typeof handoff>;

export const runAttempt = z.object({
  n: z.int().positive(),
  startedAt: isoDateTime,
  endedAt: isoDateTime.nullable(),
  outcome: attemptOutcome,
  from: runPosition,
  reached: runPosition.nullable(),
  error: z.string().nullable(),
  handoff: handoff.nullable(),
});
export type RunAttempt = z.infer<typeof runAttempt>;

export const staffRunDetail = staffRunSummary.extend({
  steps: z.array(
    runStep.extend({
      creditsSpent: z.number().nonnegative(),
      durationS: z.int().nonnegative().nullable(),
      checkpointBytes: z.int().nonnegative().nullable(),
      error: z.string().nullable(),
      toolCalls: z.array(staffToolCall),
    }),
  ),
  attempts: z.array(runAttempt),
});
export type StaffRunDetail = z.infer<typeof staffRunDetail>;

const insufficient = err(402, 'INSUFFICIENT_CREDITS');

/** FR-18. 402 carries `details: { available, required }` (see `insufficientCreditsError`). */
export const startRun = defineContract({
  method: 'POST',
  path: '/api/plans/:id/runs',
  auth: 'session',
  status: 201,
  params: idParams,
  response: runSummary,
  errors: [
    insufficient,
    err(403, 'EMAIL_NOT_VERIFIED'),
    err(404, 'NOT_FOUND'),
    err(409, 'RUN_IN_PROGRESS'),
    err(503, 'RESEARCH_UNAVAILABLE'),
  ],
});

export const getRun = defineContract({
  method: 'GET',
  path: '/api/runs/:id',
  auth: 'session',
  status: 200,
  params: idParams,
  response: runSummary,
  errors: [err(404, 'NOT_FOUND')],
});

/** Newest first. */
export const listPlanRuns = defineContract({
  method: 'GET',
  path: '/api/plans/:id/runs',
  auth: 'session',
  status: 200,
  params: idParams,
  query: listQuery(25),
  response: page(runSummary),
  errors: [err(404, 'NOT_FOUND')],
});

/** FR-21. The run becomes `cancelled` after the current Tool call finishes. */
export const cancelRun = defineContract({
  method: 'POST',
  path: '/api/runs/:id/cancel',
  auth: 'session',
  status: 202,
  params: idParams,
  response: runSummary,
  errors: [err(404, 'NOT_FOUND'), err(409, 'RUN_NOT_ACTIVE')],
});

/** FR-21 "Try again": a new attempt from the stored progress, new Reservation for what's left. */
export const resumeRun = defineContract({
  method: 'POST',
  path: '/api/runs/:id/resume',
  auth: 'session',
  status: 202,
  params: idParams,
  response: runSummary,
  errors: [
    insufficient,
    err(404, 'NOT_FOUND'),
    err(409, 'RUN_NOT_FAILED'),
    err(409, 'RUN_IN_PROGRESS'),
  ],
});

/** FR-32. Newest first. */
export const listStaffRuns = defineContract({
  method: 'GET',
  path: '/api/staff/runs',
  auth: 'staff',
  status: 200,
  query: listQuery(25).extend({ status: runStatus.optional(), businessId: id.optional() }),
  response: page(staffRunSummary),
});

export const getStaffRun = defineContract({
  method: 'GET',
  path: '/api/staff/runs/:id',
  auth: 'staff',
  status: 200,
  params: idParams,
  response: staffRunDetail,
  errors: [err(404, 'NOT_FOUND')],
});

/** FR-32. Same run id, new attempt from the last handoff; Audit log entry. */
export const resumeStaffRun = defineContract({
  method: 'POST',
  path: '/api/staff/runs/:id/resume',
  auth: 'staff',
  status: 202,
  params: idParams,
  response: runSummary,
  errors: [
    insufficient,
    err(404, 'NOT_FOUND'),
    err(409, 'RUN_NOT_FAILED'),
    err(409, 'RUN_IN_PROGRESS'),
  ],
});

/** FR-32 queue health. */
export const getQueueHealth = defineContract({
  method: 'GET',
  path: '/api/staff/queue',
  auth: 'staff',
  status: 200,
  response: z.object({
    waiting: z.int().nonnegative(),
    active: z.int().nonnegative(),
    failed: z.int().nonnegative(),
    delayed: z.int().nonnegative(),
    retrying: z.int().nonnegative(),
    stalledFound: z.int().nonnegative(),
    sweeperLastRunAt: isoDateTime.nullable(),
    workerLastSeenAt: isoDateTime.nullable(),
  }),
});

// Research flows (FR-37) ---------------------------------------------------------------------------

export const flowKey = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(64);

export const runSettings = z.object({
  maxActiveMinutes: z.int().min(1),
  maxTotalHours: z.number().positive(),
  maxAttempts: z.int().min(1),
  /** Wait before attempt n+1 is `retryWaitsMinutes[n-1]`; the last value repeats. */
  retryWaitsMinutes: z.array(z.int().min(0).max(1_440)).min(1).max(10),
  workerStoppedAfterMinutes: z.int().min(1).max(60),
  /** Stop collection and move to Verify/Score at this share of max credits… */
  scoreAtBudgetPct: z.int().min(1).max(100),
  /** …or after this many active minutes (FR-20). */
  scoreAtMinutes: z.int().min(1),
});
export type RunSettings = z.infer<typeof runSettings>;

export const planDefaults = z.object({
  maxCredits: z.int().min(10),
  maxLeads: z.int().min(10),
  minFitScore: z.int().min(40).max(90),
});
export type PlanDefaults = z.infer<typeof planDefaults>;

export const flowStep = z.object({
  key: stepKey,
  name: z.string().trim().min(1).max(60),
  /** Tool keys the Step's agent may call. */
  tools: z.array(z.string().min(1).max(64)),
  budgetPct: z.int().min(0).max(100),
  timeLimitMinutes: z.int().min(1).max(1_440),
  required: z.boolean(),
});
export type FlowStep = z.infer<typeof flowStep>;

export const flow = z.object({
  key: flowKey,
  name: z.string(),
  version: z.int().positive(),
  runSettings,
  planDefaults,
  steps: z.array(flowStep).min(1),
  /** The platform ceilings the values must stay within (FR-8). */
  ceilings,
});
export type Flow = z.infer<typeof flow>;

export const BUDGET_SHARES_MESSAGE = 'Step budget shares must add up to 100%';

/** Ceilings are checked by the server (400 naming the field, e.g. `runSettings.maxTotalHours`). */
export const flowInput = flow
  .omit({ version: true, ceilings: true })
  .extend({ name: z.string().trim().min(1).max(120) })
  .refine((f) => f.steps.reduce((sum, s) => sum + s.budgetPct, 0) === 100, {
    path: ['steps'],
    message: BUDGET_SHARES_MESSAGE,
  });
export type FlowInput = z.infer<typeof flowInput>;

export const flowListItem = z.object({
  key: flowKey,
  name: z.string(),
  version: z.int().positive(),
  isDefault: z.boolean(),
  plansUsing: z.int().nonnegative(),
  updatedAt: isoDateTime,
});
export type FlowListItem = z.infer<typeof flowListItem>;

const flowParams = z.object({ key: flowKey });

export const listFlows = defineContract({
  method: 'GET',
  path: '/api/staff/flows',
  auth: 'staff',
  status: 200,
  response: page(flowListItem),
});

/** The latest version. */
export const getFlow = defineContract({
  method: 'GET',
  path: '/api/staff/flows/:key',
  auth: 'staff',
  status: 200,
  params: flowParams,
  response: flow,
  errors: [err(404, 'NOT_FOUND')],
});

/** Saves a new version; runs already started keep theirs. Audit log entry with changed fields. */
export const updateFlow = defineContract({
  method: 'PUT',
  path: '/api/staff/flows/:key',
  auth: 'staff',
  status: 201,
  params: flowParams,
  body: flowInput,
  response: flow,
  errors: [err(404, 'NOT_FOUND')],
});

export const researchContracts = {
  startRun,
  getRun,
  listPlanRuns,
  cancelRun,
  resumeRun,
  listStaffRuns,
  getStaffRun,
  resumeStaffRun,
  getQueueHealth,
  listFlows,
  getFlow,
  updateFlow,
} as const;
