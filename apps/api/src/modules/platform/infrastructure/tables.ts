import type { Json, Timestamp } from '../../../shared/infrastructure/db/schema.js';

/** One encrypted secret field (ADR 0012). */
export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
  last4: string;
  updatedAt: string;
}

export interface SettingsTable {
  /** `ai`, `providers`, `email`, `stripe`, `analytics`, `ceilings`, `landing`, `support`. */
  section: string;
  value_json: Json<Record<string, unknown>>;
  /** Keyed by field path, e.g. `anthropicApiKey`, `twilio.authToken`. */
  secrets_enc: Json<Record<string, EncryptedSecret>> | null;
  updated_by: string | null;
  updated_at: Timestamp;
}

export interface AuditLogTable {
  id: string;
  at: Timestamp;
  staff_member_id: string;
  business_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Json<Record<string, unknown>>;
}

export interface AnalyticsEventsTable {
  id: string;
  name: string;
  business_id: string | null;
  member_id: string | null;
  properties: Json<Record<string, unknown>>;
  at: Timestamp;
}

export interface PlatformTables {
  settings: SettingsTable;
  audit_log: AuditLogTable;
  analytics_events: AnalyticsEventsTable;
}
