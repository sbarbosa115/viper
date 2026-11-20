import type { Generated } from 'kysely';
import type { Json, Timestamp } from '../db/schema.js';

export interface OutboxTable {
  /** UUID v7, so ids sort by creation. */
  id: string;
  type: string;
  payload: Json<Record<string, unknown>>;
  created_at: Timestamp;
  dispatched_at: Timestamp | null;
  attempts: Generated<number>;
  last_error: string | null;
}

export interface OutboxTables {
  outbox: OutboxTable;
}
