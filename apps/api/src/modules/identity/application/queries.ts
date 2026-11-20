import { NotFoundError } from '../../../shared/domain/errors.js';
import type { Business } from '../domain/business.js';
import type {
  BusinessListItem,
  BusinessListQuery,
  BusinessWithOwner,
  IdentityServices,
} from './ports.js';

export interface BusinessSummary {
  id: string;
  name: string;
  internal: boolean;
  createdAt: Date;
  lastActiveAt: Date | null;
}

/** Who made a Staff change, for its Audit log entry (FR-7). */
export interface StaffChange {
  staffMemberId: string;
  action: string;
  details: Record<string, unknown>;
}

export interface OwnerContact {
  email: string;
  name: string;
  emailVerified: boolean;
}

/** identity's public query API for other modules (context map: they never join our tables). */
export interface IdentityQueries {
  getBusiness(id: string): Promise<BusinessSummary | null>;
  /** Batch lookup, to avoid N+1 queries (order not guaranteed; missing ids are skipped). */
  getBusinesses(ids: readonly string[]): Promise<BusinessSummary[]>;
  /** Staff customer list (FR-31): search by Business name or Owner email, cursor pagination. */
  listBusinesses(
    query: BusinessListQuery,
  ): Promise<{ items: BusinessListItem[]; nextCursor: string | null }>;
  /** Staff dashboard (FR-30): every Business with its Owner, unordered. */
  allBusinesses(): Promise<BusinessWithOwner[]>;
  getOwnerContact(businessId: string): Promise<OwnerContact | null>;
  /** Business name edits (2–120 characters); 404 when unknown. */
  renameBusiness(businessId: string, name: string): Promise<void>;
  /**
   * FR-31 "mark internal": excluded from customer and revenue tiles. With `by`, the Audit log
   * entry is written in the same transaction (nothing is written for an unknown Business: 404).
   */
  setBusinessInternal(businessId: string, internal: boolean, by?: StaffChange): Promise<void>;
  /** Member emails by id, for the Audit log (missing ids are skipped). */
  getMemberEmails(memberIds: readonly string[]): Promise<Map<string, string>>;
}

function summary(b: Business): BusinessSummary {
  return {
    id: b.id,
    name: b.name,
    internal: b.internal,
    createdAt: b.createdAt,
    lastActiveAt: b.lastActiveAt,
  };
}

export function identityQueriesFrom(
  s: Pick<IdentityServices, 'repos' | 'uow' | 'directory'>,
): IdentityQueries {
  async function update(
    businessId: string,
    change: (b: Business) => void,
    by?: StaffChange,
  ): Promise<void> {
    await s.uow.run(async (r) => {
      const business = await r.businesses.findById(businessId);
      if (!business) throw new NotFoundError('Business not found', { businessId });
      change(business);
      await r.businesses.save(business);
      if (by) {
        await r.audit.record({
          staffMemberId: by.staffMemberId,
          businessId,
          action: by.action,
          targetType: 'business',
          targetId: businessId,
          details: by.details,
        });
      }
    });
  }

  return {
    async getBusiness(id) {
      const b = await s.repos.businesses.findById(id);
      return b ? summary(b) : null;
    },
    async getBusinesses(ids) {
      if (ids.length === 0) return [];
      return (await s.repos.businesses.findByIds([...new Set(ids)])).map(summary);
    },
    listBusinesses: (query) => s.directory.list(query),
    allBusinesses: () => s.directory.all(),
    async getOwnerContact(businessId) {
      const owner = await s.repos.members.findOwnerOf(businessId);
      return owner
        ? { email: owner.email, name: owner.name, emailVerified: owner.emailVerified }
        : null;
    },
    renameBusiness: (businessId, name) => update(businessId, (b) => b.rename(name)),
    setBusinessInternal: (businessId, internal, by) =>
      update(businessId, (b) => b.markInternal(internal), by),
    async getMemberEmails(memberIds) {
      const ids = [...new Set(memberIds)];
      if (ids.length === 0) return new Map();
      const members = await s.repos.members.findByIds(ids);
      return new Map(members.map((m) => [m.id, m.email]));
    },
  };
}
