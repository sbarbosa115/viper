import type { ColumnType, Generated } from 'kysely';
import type { Bool, Timestamp } from '../../../shared/infrastructure/db/schema.js';

/**
 * TINYINT(1) with a database default. `Generated<Bool>` would nest two ColumnTypes, which Kysely
 * does not unwrap (selects would be typed as the ColumnType itself).
 */
type DefaultedBool = ColumnType<number, boolean | number | undefined, boolean | number>;

export interface BusinessesTable {
  id: string;
  name: string;
  internal: DefaultedBool;
  created_at: Timestamp;
  last_active_at: Timestamp | null;
}

export interface MembersTable {
  id: string;
  business_id: string;
  /** Stored lowercased. */
  email: string;
  name: string;
  password_hash: string;
  role: Generated<'owner'>;
  is_staff: DefaultedBool;
  email_verified_at: Timestamp | null;
  /** AES-256-GCM ciphertext (ADR 0012). */
  totp_secret_enc: Buffer | null;
  totp_enabled_at: Timestamp | null;
  /** RFC 6238 time step of the last code that passed: older or equal codes are refused (FR-5). */
  totp_last_step: ColumnType<number | null, number | null | undefined, number | null>;
  /** Two-factor locked after 10 wrong codes in an hour (FR-5); null when never locked. */
  two_factor_locked_until: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: Timestamp;
}

export interface SessionsTable {
  /** sha-256 of the session token, hex. */
  id: string;
  member_id: string;
  acting_as_business_id: string | null;
  two_factor_passed: DefaultedBool;
  /** Two-factor codes tried on this half-session, counted before each check (FR-5). */
  two_factor_failures: Generated<number>;
  created_at: Timestamp;
  last_seen_at: Timestamp;
  expires_at: Timestamp;
}

export interface EmailTokensTable {
  id: string;
  member_id: string;
  purpose: 'verify' | 'reset';
  token_hash: string;
  created_at: Timestamp;
  expires_at: Timestamp;
  used_at: Timestamp | null;
}

export interface LoginAttemptsTable {
  id: string;
  email: string;
  ip: string;
  success: Bool;
  created_at: Timestamp;
}

export interface IdentityTables {
  businesses: BusinessesTable;
  members: MembersTable;
  sessions: SessionsTable;
  email_tokens: EmailTokensTable;
  login_attempts: LoginAttemptsTable;
}
