import type { Actor } from '../../../shared/domain/actor.js';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import { createLeadsApplication } from '../application/leads.js';
import type { LeadsUnitOfWork, PlanLookup, RunCosts } from '../application/ports.js';
import type { ProspectStore } from '../application/prospect-store.js';
import type { ContactInput, ProspectInput, SourceRef } from '../domain/prospect.js';
import { InMemoryLeads } from '../infrastructure/in-memory-leads.js';

export const BUSINESS = '00000000-0000-7000-8000-00000000b001';
export const OTHER_BUSINESS = '00000000-0000-7000-8000-00000000b002';
export const OWNER_ID = '00000000-0000-7000-8000-00000000c001';
export const OTHER_OWNER_ID = '00000000-0000-7000-8000-00000000c003';
export const STAFF_ID = '00000000-0000-7000-8000-00000000c002';
export const PLAN = '00000000-0000-7000-8000-00000000e001';
export const OTHER_PLAN = '00000000-0000-7000-8000-00000000e002';
export const RUN_1 = '00000000-0000-7000-8000-00000000f001';
export const RUN_2 = '00000000-0000-7000-8000-00000000f002';
export const OTHER_RUN = '00000000-0000-7000-8000-00000000f003';
export const CANE_SUGAR = '00000000-0000-7000-8000-00000000d201';
export const UNKNOWN_ID = '00000000-0000-7000-8000-00000000ffff';

/** Sweet Supply Co's address point, the centre of the bakeries Plan. */
export const CENTRE = { lat: 30.2624, lng: -97.7262 };

export const MAPS: SourceRef = {
  name: 'Google Maps',
  url: 'https://maps.example/place/1',
  retrievedAt: '2026-11-19T10:00:00.000Z',
};
export const ZEROBOUNCE: SourceRef = {
  name: 'ZeroBounce',
  url: null,
  retrievedAt: '2026-11-19T10:10:00.000Z',
};
export const TWILIO: SourceRef = {
  name: 'Twilio Lookup',
  url: null,
  retrievedAt: '2026-11-19T10:11:00.000Z',
};

export function owner(overrides: Partial<Actor> = {}): Actor {
  return {
    memberId: OWNER_ID,
    businessId: BUSINESS,
    roles: ['owner'],
    emailVerified: true,
    ...overrides,
  };
}

export function otherOwner(): Actor {
  return owner({ memberId: OTHER_OWNER_ID, businessId: OTHER_BUSINESS });
}

export function actingAs(): Actor {
  return owner({
    memberId: STAFF_ID,
    roles: ['owner', 'staff'],
    actingAs: { businessId: BUSINESS, businessName: 'Sweet Supply Co', staffMemberId: STAFF_ID },
  });
}

/** planning's Plans, by Business. */
export class FakePlans implements PlanLookup {
  readonly plans = new Map<string, { businessId: string; name: string }>([
    [PLAN, { businessId: BUSINESS, name: 'Bakeries near Austin' }],
    [OTHER_PLAN, { businessId: OTHER_BUSINESS, name: 'Other plan' }],
  ]);
  findPlan(businessId: string, planId: string) {
    const p = this.plans.get(planId);
    return Promise.resolve(
      p?.businessId === businessId ? { id: planId, name: p.name, centre: CENTRE } : null,
    );
  }
}

/** research's credits per Plan and run. */
export class FakeRunCosts implements RunCosts {
  readonly byRun = new Map<string, { planId: string; credits: number }>();
  readonly calls: { businessId: string; planId: string; runId?: string | undefined }[] = [];
  creditsSpentForPlan(businessId: string, planId: string, runId?: string) {
    this.calls.push({ businessId, planId, runId });
    let total = 0;
    for (const [id, r] of this.byRun) {
      if (r.planId === planId && (!runId || id === runId)) total += r.credits;
    }
    return Promise.resolve(total);
  }
}

export function setup(uow: LeadsUnitOfWork = new InMemoryLeads()) {
  const clock = new FixedClock(new Date('2026-11-19T12:00:00.000Z'));
  const analytics = new RecordingAnalyticsTracker();
  const plans = new FakePlans();
  const runCosts = new FakeRunCosts();
  const ids = new SequentialIdGenerator();
  const app = createLeadsApplication({ uow, clock, ids, analytics, plans, runCosts });
  return { uow, clock, analytics, plans, runCosts, ids, app };
}

let place = 0;

/** A bakery as the Maps step finds it; each call is a new place unless keys are given. */
export function bakery(overrides: Partial<ProspectInput> = {}): ProspectInput {
  place += 1;
  return {
    name: `Bakery ${place}`,
    address: `${place} E 6th St, Austin, TX`,
    lat: CENTRE.lat + place * 0.001,
    lng: CENTRE.lng,
    category: 'Bakery',
    phone: `512-555-${(1000 + place).toString().slice(-4)}`,
    placeKeys: [`google:place-${place}`],
    source: MAPS,
    ...overrides,
  };
}

export const verifiedEmail = (value: string): ContactInput => ({
  type: 'email',
  value,
  verification: 'verified',
  source: ZEROBOUNCE,
  checked: true,
});

/**
 * Adds a bakery to the run and scores it like Steps 5–9 (a verified email, Evidence, a Pitch).
 * Returns the Prospect id.
 */
export async function scoredProspect(
  store: ProspectStore,
  options: {
    runId?: string;
    businessId?: string;
    fitScore: number;
    input?: Partial<ProspectInput>;
    contacts?: ContactInput[];
  },
): Promise<string> {
  const [id] = await store.addProspects(options.runId ?? RUN_1, options.businessId ?? BUSINESS, [
    bakery(options.input),
  ]);
  if (!id) throw new Error('no id');
  await store.updateProspect(id, {
    fitScore: options.fitScore,
    pitch: { productId: CANE_SUGAR, productName: 'Cane sugar, 50 lb bag', reason: 'Bakes daily' },
    evidence: [
      { fact: 'Bakes bread on site every morning', points: 20, source: MAPS },
      {
        fact: 'Independent, one location',
        points: 10,
        source: { ...MAPS, url: 'https://site.example' },
      },
    ],
    contacts: options.contacts ?? [verifiedEmail(`hello${id.slice(-4)}@bakery.example`)],
  });
  return id;
}

export const deliverCommand = (
  overrides: Partial<{ runId: string; maxLeads: number; minFitScore: number }> = {},
) => ({
  runId: RUN_1,
  businessId: BUSINESS,
  planId: PLAN,
  minFitScore: 60,
  maxLeads: 100,
  ...overrides,
});
