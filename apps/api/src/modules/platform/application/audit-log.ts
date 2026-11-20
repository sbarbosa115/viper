import type { AuditLogEntry } from '@app/contracts/platform';
import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import { ValidationError } from '../../../shared/domain/errors.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import { scrubAuditDetails } from '../domain/audit-action.js';
import type {
  AuditCursor,
  AuditDirectory,
  AuditEntry,
  AuditLogFilter,
  AuditLogRepository,
} from './ports.js';
import { requireStaff } from './staff-policy.js';

export interface AuditRecord {
  readonly staffMemberId: string;
  readonly businessId: string | null;
  /** Dot-named, e.g. `acting_as.started`, `credits.granted`. */
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  /** Changed field names and ids, never secret values (secret-named keys are dropped). */
  readonly details?: Readonly<Record<string, unknown>>;
}

/** The Audit log's write side, used by every module for Staff actions (FR-7). Append-only. */
export interface AuditRecorder {
  record(entry: AuditRecord): Promise<void>;
}

export function auditEntry(
  record: AuditRecord,
  deps: { clock: Clock; ids: IdGenerator },
): AuditEntry {
  return {
    id: deps.ids.next(),
    at: deps.clock.now(),
    staffMemberId: record.staffMemberId,
    businessId: record.businessId,
    action: record.action,
    targetType: record.targetType,
    targetId: record.targetId,
    details: scrubAuditDetails(record.details ?? {}),
  };
}

export class AuditLog implements AuditRecorder {
  constructor(
    private readonly deps: { repository: AuditLogRepository; clock: Clock; ids: IdGenerator },
  ) {}

  record(record: AuditRecord): Promise<void> {
    return this.deps.repository.append(auditEntry(record, this.deps));
  }
}

export function encodeAuditCursor(entry: Pick<AuditEntry, 'at' | 'id'>): string {
  return Buffer.from(JSON.stringify([entry.at.toISOString(), entry.id])).toString('base64url');
}

export function decodeAuditCursor(cursor: string): AuditCursor {
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown[];
    const date = new Date(String(at));
    if (typeof id !== 'string' || Number.isNaN(date.getTime())) throw new Error('bad cursor');
    return { at: date, id };
  } catch {
    throw new ValidationError('The cursor is not valid', { cursor: 'Invalid cursor' });
  }
}

const UNKNOWN_EMAIL = 'unknown@llyner.invalid';

export class ListAuditLog {
  constructor(
    private readonly deps: { repository: AuditLogRepository; directory: AuditDirectory },
  ) {}

  async execute(query: {
    actor: Actor | null;
    filter: AuditLogFilter;
    cursor?: string | undefined;
    limit: number;
  }): Promise<{ items: AuditLogEntry[]; nextCursor: string | null }> {
    requireStaff(query.actor);
    const cursor = query.cursor ? decodeAuditCursor(query.cursor) : null;
    const rows = await this.deps.repository.list(query.filter, cursor, query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor = rows.length > query.limit && last ? encodeAuditCursor(last) : null;

    const { members, businesses } = await this.deps.directory.lookup({
      memberIds: [...new Set(page.map((e) => e.staffMemberId))],
      businessIds: [...new Set(page.flatMap((e) => (e.businessId ? [e.businessId] : [])))],
    });
    const items = page.map((e) => ({
      id: e.id,
      at: e.at.toISOString(),
      staff: { id: e.staffMemberId, email: members.get(e.staffMemberId)?.email ?? UNKNOWN_EMAIL },
      business: e.businessId
        ? { id: e.businessId, name: businesses.get(e.businessId)?.name ?? 'Unknown business' }
        : null,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId,
      details: { ...e.details },
    }));
    return { items, nextCursor };
  }
}
