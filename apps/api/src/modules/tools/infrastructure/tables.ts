import type { Generated } from 'kysely';
import type {
  Decimal,
  DefaultedBool,
  Json,
  Timestamp,
} from '../../../shared/infrastructure/db/schema.js';

export interface ToolsTable {
  key: string;
  name: string;
  provider: string;
  unit: string;
  provider_cost_micros_per_unit: number;
  /** DECIMAL(10,3). */
  credits_per_unit: Decimal;
  enabled: DefaultedBool;
  max_units_per_call: number;
  updated_at: Timestamp;
}

export interface ToolCallsTable {
  id: string;
  /** Null for calls outside a run (welcome chat, plan drafting). */
  run_id: string | null;
  step_key: string | null;
  attempt_n: number | null;
  /** Answered from a stored call on a later attempt (0 credits). */
  reused: DefaultedBool;
  business_id: string;
  tool_key: string;
  /** sha-256 of the canonical input, hex. */
  input_hash: string;
  input: Json<unknown>;
  output: Json<unknown> | null;
  units: Generated<number>;
  millicredits: Generated<number>;
  provider_cost_micros: Generated<number>;
  status: 'ok' | 'error' | 'skipped' | 'started';
  error: string | null;
  duration_ms: Generated<number>;
  created_at: Timestamp;
}

export interface ToolsTables {
  tools: ToolsTable;
  tool_calls: ToolCallsTable;
}
