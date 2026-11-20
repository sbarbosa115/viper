import type { SettingsTestTarget } from '@app/contracts/platform';
import type { SettingsSectionKey, StoredSection } from '../domain/settings.js';

/** AES-256-GCM sealing of one secret. `context` (e.g. `ai.anthropicApiKey`) is bound as AAD. */
export interface SealedValue {
  readonly ciphertext: string;
  readonly iv: string;
  readonly tag: string;
}

export interface SecretBox {
  encrypt(plaintext: string, context: string): SealedValue;
  /** Throws when the value was sealed under another key or context, or was tampered with. */
  decrypt(sealed: SealedValue, context: string): string;
}

export interface SettingsRepository {
  findAll(): Promise<StoredSection[]>;
  find(section: SettingsSectionKey): Promise<StoredSection | null>;
  save(section: StoredSection): Promise<void>;
}

export interface AuditEntry {
  readonly id: string;
  readonly at: Date;
  readonly staffMemberId: string;
  readonly businessId: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface AuditLogFilter {
  readonly businessId?: string | undefined;
  readonly staffMemberId?: string | undefined;
  readonly action?: string | undefined;
}

export interface AuditCursor {
  readonly at: Date;
  readonly id: string;
}

/** Append-only: there is no update or delete. */
export interface AuditLogRepository {
  append(entry: AuditEntry): Promise<void>;
  /** Newest first (at, then id, descending), strictly after `cursor` when given. */
  list(filter: AuditLogFilter, cursor: AuditCursor | null, limit: number): Promise<AuditEntry[]>;
}

/**
 * Names for Audit log rows: Staff emails and Business names live in identity (provided by its
 * public API at composition time; platform never reads identity's tables).
 */
export interface AuditDirectory {
  lookup(query: { memberIds: readonly string[]; businessIds: readonly string[] }): Promise<{
    members: ReadonlyMap<string, { email: string }>;
    businesses: ReadonlyMap<string, { name: string }>;
  }>;
}

export interface ConnectivityResult {
  readonly ok: boolean;
  readonly message: string;
}

/** One Settings "Test" action (FR-8). Must never put a secret value in `message`. */
export type ConnectivityCheck = (input: {
  to?: string | undefined;
  signal: AbortSignal;
}) => Promise<ConnectivityResult>;

export type ConnectivityTester = Readonly<Record<SettingsTestTarget, ConnectivityCheck>>;
