import type { Generated } from 'kysely';
import type { DefaultedBool, Json, Timestamp } from '../../../shared/infrastructure/db/schema.js';

/**
 * JSON column payloads are owned by the research module; they stay `unknown`-valued records
 * here and are parsed by its mappers.
 */
type JsonObject = Record<string, unknown>;

export type RunStatusColumn =
  'queued' | 'running' | 'retrying' | 'completed' | 'failed' | 'cancelled';
export type StepStatusColumn = 'pending' | 'running' | 'done' | 'skipped' | 'failed';
export type AttemptStatusColumn =
  'running' | 'completed' | 'retryable_error' | 'final_error' | 'worker_stopped' | 'cancelled';

export interface ResearchFlowsTable {
  id: string;
  key: string;
  name: string;
  version: number;
  /** `{ runSettings, planDefaults }`. */
  settings: Json<JsonObject>;
  /** `[{ key, name, goal, tools, budgetPct, timeLimitMinutes, required }]`. */
  steps: Json<JsonObject[]>;
  is_template: DefaultedBool;
  is_default: DefaultedBool;
  business_id: string | null;
  created_by: string | null;
  created_at: Timestamp;
}

export interface ResearchRunsTable {
  id: string;
  business_id: string;
  plan_id: string;
  flow_id: string;
  flow_version: number;
  /** Snapshot of the flow's settings and steps when the run started. */
  flow_settings: Json<JsonObject>;
  plan_snapshot: Json<JsonObject>;
  prompt_version: string | null;
  status: RunStatusColumn;
  started_by_member_id: string;
  started_by_staff_id: string | null;
  attempts: Generated<number>;
  /** Attempts this run may use: the flow's max attempts plus one per resume (null = the flow's). */
  attempt_limit: number | null;
  active_seconds: Generated<number>;
  /** Active seconds already counted when the current limits window began (resume). */
  active_offset_seconds: Generated<number>;
  /** Tools disabled for this run and failures in a row (runner state across steps). */
  run_state: Json<JsonObject> | null;
  next_attempt_at: Timestamp | null;
  cancel_requested_at: Timestamp | null;
  budget_reached: DefaultedBool;
  time_reached: DefaultedBool;
  failure_code: string | null;
  queued_at: Timestamp;
  started_at: Timestamp | null;
  /** Where the total-time limit counts from: the first start, or the latest resume. */
  window_started_at: Timestamp | null;
  finished_at: Timestamp | null;
  credits_reserved: number;
  credits_spent: Generated<number>;
  millicredits_spent: Generated<number>;
  provider_cost_micros: Generated<number>;
  leads_delivered: Generated<number>;
}

export interface RunStepsTable {
  id: string;
  run_id: string;
  step_key: string;
  position: number;
  status: StepStatusColumn;
  attempts: Generated<number>;
  /** Work items done and remaining, saved after every Tool call. */
  progress: Json<JsonObject> | null;
  started_at: Timestamp | null;
  finished_at: Timestamp | null;
  millicredits_spent: Generated<number>;
  checkpoint: Json<JsonObject> | null;
  error: string | null;
}

export interface RunAttemptsTable {
  id: string;
  run_id: string;
  n: number;
  status: AttemptStatusColumn;
  from_step: string;
  from_item: Generated<number>;
  reached_step: string | null;
  reached_item: number | null;
  error: string | null;
  /** Copy of the handoff when the attempt ended (shown per attempt to Staff). */
  handoff: Json<JsonObject> | null;
  lease_owner: string | null;
  lease_expires_at: Timestamp | null;
  started_at: Timestamp;
  ended_at: Timestamp | null;
  active_seconds: Generated<number>;
}

export interface RunHandoffsTable {
  run_id: string;
  attempt_n: number;
  step_key: string;
  items_done: Generated<number>;
  items_left: Generated<number>;
  notes: Generated<string>;
  last_error: string | null;
  credits_left: number;
  active_seconds_left: number;
  updated_at: Timestamp;
}

export interface RunMessagesTable {
  id: string;
  run_id: string;
  attempt_n: number;
  step_key: string;
  role: string;
  content: Json<unknown>;
  created_at: Timestamp;
}

/** One row per (outbox event, recipient): run emails are sent once (FR-22). */
export interface ResearchRunEmailsTable {
  event_id: string;
  recipient: 'owner' | 'support';
  run_id: string;
  sent_at: Timestamp;
}

export interface ResearchTables {
  research_run_emails: ResearchRunEmailsTable;
  research_flows: ResearchFlowsTable;
  research_runs: ResearchRunsTable;
  run_steps: RunStepsTable;
  run_attempts: RunAttemptsTable;
  run_handoffs: RunHandoffsTable;
  run_messages: RunMessagesTable;
}
