import type { IdentityServices } from './ports.js';
import type { IdentityQueries } from './queries.js';

export interface SupportMemberSummary {
  id: string;
  name: string;
  email: string;
  businessId: string;
  role: 'owner' | 'member';
  isStaff: boolean;
}

/** identity's reads for the support module (prd-support section 7, `IdentityForSupport`). */
export interface IdentitySupportQueries {
  /** Members by id, in one batch; unknown ids are left out. */
  memberSummaries(ids: readonly string[]): Promise<SupportMemberSummary[]>;
  /** Every Staff Member, ordered by email. */
  staffMembers(): Promise<{ id: string; name: string; email: string }[]>;
  /** The Owner's member id (role `owner`), or null; for the composition root's test hook. */
  ownerOf(businessId: string): Promise<string | null>;
  staffRecipients: IdentityQueries['staffRecipients'];
  /** Business names by id, in one batch; unknown ids are left out. */
  businessNames(ids: readonly string[]): Promise<{ id: string; name: string }[]>;
}

export function identitySupportQueriesFrom(
  s: Pick<IdentityServices, 'repos'>,
  queries: Pick<IdentityQueries, 'staffRecipients'>,
): IdentitySupportQueries {
  return {
    async memberSummaries(ids) {
      if (ids.length === 0) return [];
      const members = await s.repos.members.findByIds([...new Set(ids)]);
      return members.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        businessId: m.businessId,
        role: m.toSnapshot().role,
        isStaff: m.isStaff,
      }));
    },
    async staffMembers() {
      return (await s.repos.members.findStaff()).map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
      }));
    },
    async ownerOf(businessId) {
      return (await s.repos.members.findOwnerOf(businessId))?.id ?? null;
    },
    staffRecipients: () => queries.staffRecipients(),
    async businessNames(ids) {
      if (ids.length === 0) return [];
      const businesses = await s.repos.businesses.findByIds([...new Set(ids)]);
      return businesses.map((b) => ({ id: b.id, name: b.name }));
    },
  };
}
