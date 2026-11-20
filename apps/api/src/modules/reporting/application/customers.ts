import type { Customer } from '@app/contracts/reporting';
import type { Actor } from '../../../shared/domain/actor.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { CustomerListQuery, CustomerListRow, ReportingDeps } from './ports.js';
import { requireStaff } from './staff-policy.js';

type Deps = Pick<ReportingDeps, 'identity' | 'billing' | 'research' | 'leads'>;

/** The customer list's columns that other contexts own, for a page of Businesses (batched). */
async function withColumns(deps: Deps, rows: readonly CustomerListRow[]): Promise<Customer[]> {
  const ids = rows.map((r) => r.id);
  const [available, paying, delivered, runs] = await Promise.all([
    deps.billing.availableByBusiness(ids),
    deps.billing.payingBusinessIds(ids),
    deps.leads.deliveredCounts(ids),
    deps.research.runCounts(ids),
  ]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ownerEmail: r.ownerEmail,
    signedUpAt: r.signedUpAt.toISOString(),
    verified: r.verified,
    availableCredits: available.get(r.id) ?? 0,
    runs: runs.get(r.id) ?? 0,
    leadsDelivered: delivered.get(r.id) ?? 0,
    lastActiveAt: r.lastActiveAt?.toISOString() ?? null,
    paying: paying.has(r.id),
    internal: r.internal,
  }));
}

/** FR-31: search by Business name or Owner email, sort by signed up or last active, 50 a page. */
export class ListCustomers {
  constructor(private readonly deps: Deps) {}

  async execute(
    query: CustomerListQuery & { actor: Actor | null },
  ): Promise<{ items: Customer[]; nextCursor: string | null }> {
    requireStaff(query.actor);
    const { actor: _actor, ...listQuery } = query;
    const page = await this.deps.identity.listBusinesses(listQuery);
    return { items: await withColumns(this.deps, page.items), nextCursor: page.nextCursor };
  }
}

/**
 * FR-31 "mark internal": an internal Business leaves the customer and revenue tiles (FR-30).
 * A back-office write, so it goes to the Audit log (FR-7), in the same transaction.
 */
export class MarkBusinessInternal {
  constructor(private readonly deps: Deps) {}

  async execute(cmd: {
    actor: Actor | null;
    businessId: string;
    internal: boolean;
  }): Promise<Customer> {
    const actor = requireStaff(cmd.actor);
    // identity checks the Business exists, then writes the change and the Audit entry together.
    await this.deps.identity.setBusinessInternal(cmd.businessId, cmd.internal, {
      staffMemberId: actor.memberId,
      action: 'business.updated',
      details: { fields: ['internal'], internal: cmd.internal },
    });
    const [business, owner] = await Promise.all([
      this.deps.identity.getBusiness(cmd.businessId),
      this.deps.identity.getOwnerContact(cmd.businessId),
    ]);
    if (!business || !owner) {
      throw new NotFoundError('Business not found', { businessId: cmd.businessId });
    }
    const [customer] = await withColumns(this.deps, [
      {
        id: business.id,
        name: business.name,
        internal: business.internal,
        ownerEmail: owner.email,
        verified: owner.emailVerified,
        signedUpAt: business.createdAt,
        lastActiveAt: business.lastActiveAt,
      },
    ]);
    if (!customer) throw new NotFoundError('Business not found', { businessId: cmd.businessId });
    return customer;
  }
}
