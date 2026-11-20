import type { Actor } from '../../../shared/domain/actor.js';
import { NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { round } from '../domain/metrics.js';
import { within, type TimeWindow } from '../domain/period.js';
import type {
  CustomerListRow,
  ReportingAudit,
  ReportingDeps,
  ReportingSources,
} from '../application/ports.js';
import type { World, WorldBusiness } from './world.js';
import { NOW } from './fixture.js';

export const staffActor: Actor = {
  memberId: '00000000-0000-4000-8000-0000000000aa',
  businessId: '00000000-0000-4000-8000-000000000001',
  roles: ['owner', 'staff'],
  emailVerified: true,
};

export const ownerActor: Actor = {
  memberId: '00000000-0000-4000-8000-0000000000bb',
  businessId: '00000000-0000-4000-8000-000000000003',
  roles: ['owner'],
  emailVerified: true,
};

export class RecordingAudit implements ReportingAudit {
  readonly entries: Parameters<ReportingAudit['record']>[0][] = [];
  /** The next write fails with this error (to test that it rolls its change back). */
  failNext: Error | null = null;
  record(entry: Parameters<ReportingAudit['record']>[0]): Promise<void> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      return Promise.reject(error);
    }
    this.entries.push(entry);
    return Promise.resolve();
  }
}

function row(b: WorldBusiness): CustomerListRow {
  return {
    id: b.id,
    name: b.name,
    internal: b.internal,
    ownerEmail: b.ownerEmail,
    verified: b.verifiedAt !== null,
    signedUpAt: b.signedUpAt,
    lastActiveAt: b.lastActiveAt,
  };
}

const sortKey = (b: WorldBusiness, sort: 'signedUp' | 'lastActive') =>
  (sort === 'lastActive' ? (b.lastActiveAt ?? b.signedUpAt) : b.signedUpAt).getTime();

/**
 * Every source port answered from a World, the way the owning modules answer (identity's
 * directory: newest first, name or email substring, opaque cursor; billing: granted = grants and
 * positive adjustments, unspent = balance − open Reservations; leads: verified % of phone and
 * email Contacts; tools: reused and skipped calls left out).
 */
/** `audit` stands in for platform's Audit log inside identity's transaction. */
export function inMemorySources(
  world: World,
  audit: ReportingAudit = new RecordingAudit(),
): ReportingSources {
  const byWindow = <T>(items: readonly T[], when: (t: T) => Date | null, w: TimeWindow) =>
    items.filter((t) => within(when(t), w));
  return {
    identity: {
      allBusinesses: () =>
        Promise.resolve(world.businesses.map(({ lastActiveAt: _l, ...fact }) => fact)),
      listBusinesses(query) {
        const q = query.q?.toLowerCase();
        const matches = world.businesses
          .filter((b) => !q || b.name.toLowerCase().includes(q) || b.ownerEmail.includes(q))
          .sort(
            (a, b) => sortKey(b, query.sort) - sortKey(a, query.sort) || b.id.localeCompare(a.id),
          );
        const start = query.cursor ? Number(Buffer.from(query.cursor, 'base64url').toString()) : 0;
        if (!Number.isInteger(start)) throw new ValidationError('Invalid cursor');
        const items = matches.slice(start, start + query.limit);
        const next = start + query.limit;
        return Promise.resolve({
          items: items.map(row),
          nextCursor:
            next < matches.length ? Buffer.from(String(next)).toString('base64url') : null,
        });
      },
      getBusiness(id) {
        const b = world.businesses.find((x) => x.id === id);
        return Promise.resolve(
          b
            ? {
                id: b.id,
                name: b.name,
                internal: b.internal,
                createdAt: b.signedUpAt,
                lastActiveAt: b.lastActiveAt,
              }
            : null,
        );
      },
      getOwnerContact(businessId) {
        const b = world.businesses.find((x) => x.id === businessId);
        return Promise.resolve(
          b ? { email: b.ownerEmail, emailVerified: b.verifiedAt !== null } : null,
        );
      },
      // Like identity: the change and its Audit entry in one transaction.
      async setBusinessInternal(businessId, internal, by) {
        const i = world.businesses.findIndex((x) => x.id === businessId);
        const found = world.businesses[i];
        if (!found) throw new NotFoundError('Business not found', { businessId });
        if (by) {
          await audit.record({
            staffMemberId: by.staffMemberId,
            businessId,
            action: by.action,
            targetType: 'business',
            targetId: businessId,
            details: by.details,
          });
        }
        world.businesses[i] = { ...found, internal };
      },
    },
    billing: {
      creditsSummary({ from, to, excludeBusinessIds }) {
        const w = { from, to };
        const counted = (businessId: string) => !excludeBusinessIds.includes(businessId);
        const ledger = world.ledger.filter((e) => counted(e.businessId));
        const inWindow = byWindow(ledger, (e) => e.at, w);
        const total = (type: string, pick: (credits: number) => boolean = () => true) =>
          inWindow
            .filter((e) => e.type === type && pick(e.credits))
            .reduce((s, e) => s + e.credits, 0);
        const held = world.reservations
          .filter((r) => r.status === 'open' && counted(r.businessId))
          .reduce((s, r) => s + r.credits, 0);
        return Promise.resolve({
          packRevenueCents: byWindow(world.purchases, (p) => p.paidAt, w)
            .filter((p) => counted(p.businessId))
            .reduce((s, p) => s + p.amountCents, 0),
          creditsGranted: total('grant') + total('adjustment', (c) => c > 0),
          creditsPurchased: total('purchase'),
          creditsSpent: -total('settlement'),
          unspentCredits: ledger.reduce((s, e) => s + e.credits, 0) - held,
        });
      },
      availableByBusiness(ids) {
        return Promise.resolve(
          new Map(
            ids.map((id) => [
              id,
              world.ledger.filter((e) => e.businessId === id).reduce((s, e) => s + e.credits, 0) -
                world.reservations
                  .filter((r) => r.businessId === id && r.status === 'open')
                  .reduce((s, r) => s + r.credits, 0),
            ]),
          ),
        );
      },
      payingBusinessIds(ids, options) {
        const before = options?.paidBefore;
        return Promise.resolve(
          new Set(
            world.purchases
              .filter((p) => ids.includes(p.businessId) && (!before || p.paidAt < before))
              .map((p) => p.businessId),
          ),
        );
      },
    },
    research: {
      runFacts: (w) => Promise.resolve(byWindow(world.runs, (r) => r.queuedAt, w)),
      runCounts(ids) {
        const counts = new Map<string, number>();
        for (const r of world.runs) {
          if (ids.includes(r.businessId))
            counts.set(r.businessId, (counts.get(r.businessId) ?? 0) + 1);
        }
        return Promise.resolve(counts);
      },
    },
    leads: {
      leadQuality(w) {
        const leads = byWindow(world.leads, (l) => l.deliveredAt, w);
        const withFeedback = leads.filter((l) => l.feedback !== null).length;
        const good = leads.filter((l) => l.feedback === 'good').length;
        const contacts = leads.flatMap((l) => l.contacts);
        const verified = contacts.filter((c) => c.verified).length;
        return Promise.resolve({
          delivered: leads.length,
          good,
          goodPct: withFeedback > 0 ? round((good / withFeedback) * 100, 1) : null,
          verifiedPct: contacts.length > 0 ? round((verified / contacts.length) * 100, 1) : null,
        });
      },
      deliveredCounts(ids) {
        const counts = new Map<string, number>();
        for (const l of world.leads) {
          if (ids.includes(l.businessId))
            counts.set(l.businessId, (counts.get(l.businessId) ?? 0) + 1);
        }
        return Promise.resolve(counts);
      },
    },
    tools: {
      spendByTool(w) {
        const totals = new Map<
          string,
          { providerCostMicros: number; calls: number; errors: number }
        >();
        for (const c of byWindow(world.toolCalls, (t) => t.at, w)) {
          if (c.reused || c.status === 'skipped') continue;
          const t = totals.get(c.toolKey) ?? { providerCostMicros: 0, calls: 0, errors: 0 };
          t.providerCostMicros += c.providerCostMicros;
          t.calls += 1;
          if (c.status === 'error') t.errors += 1;
          totals.set(c.toolKey, t);
        }
        return Promise.resolve([...totals].map(([toolKey, t]) => ({ toolKey, ...t })));
      },
    },
  };
}

export function fakeDeps(world: World, now: Date = NOW): ReportingDeps & { audit: RecordingAudit } {
  const audit = new RecordingAudit();
  return { ...inMemorySources(world, audit), audit, clock: new FixedClock(now) };
}
