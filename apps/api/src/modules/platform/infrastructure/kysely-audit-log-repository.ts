import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../../../shared/infrastructure/db/schema.js';
import type {
  AuditCursor,
  AuditEntry,
  AuditLogFilter,
  AuditLogRepository,
} from '../application/ports.js';

/** Append-only: inserts and reads, never updates or deletes. */
export class KyselyAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: Kysely<DB> | Transaction<DB>) {}

  async append(entry: AuditEntry): Promise<void> {
    await this.db
      .insertInto('audit_log')
      .values({
        id: entry.id,
        at: entry.at,
        staff_member_id: entry.staffMemberId,
        business_id: entry.businessId,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId,
        details: JSON.stringify(entry.details),
      })
      .execute();
  }

  async list(
    filter: AuditLogFilter,
    cursor: AuditCursor | null,
    limit: number,
  ): Promise<AuditEntry[]> {
    let query = this.db.selectFrom('audit_log').selectAll();
    if (filter.businessId) query = query.where('business_id', '=', filter.businessId);
    if (filter.staffMemberId) query = query.where('staff_member_id', '=', filter.staffMemberId);
    if (filter.action) query = query.where('action', '=', filter.action);
    if (cursor) {
      query = query.where((eb) =>
        eb.or([
          eb('at', '<', cursor.at),
          eb.and([eb('at', '=', cursor.at), eb('id', '<', cursor.id)]),
        ]),
      );
    }
    const rows = await query.orderBy('at', 'desc').orderBy('id', 'desc').limit(limit).execute();
    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      staffMemberId: row.staff_member_id,
      businessId: row.business_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      details: row.details,
    }));
  }
}
