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
  created_at: Timestamp;
}

export interface SessionsTable {
  /** sha-256 of the session token, hex. */
  id: string;
  member_id: string;
  acting_as_business_id: string | null;
  two_factor_passed: DefaultedBool;
  /** Wrong two-factor codes on this half-session; 5 delete it (FR-5). */
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
