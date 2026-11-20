import type { Dashboard } from '@app/contracts/reporting';
import type { RunFact } from '../domain/metrics.js';
import type { World, WorldLead, WorldToolCall } from './world.js';

/**
 * A small world with hand-computed dashboard numbers (period 30d at NOW):
 * current window [2026-10-22, 2026-11-21), previous [2026-09-22, 2026-10-22).
 * Customers: Sweet, Corner, Bagels, Clean, Bakery. Not customers: the Staff's own Business and
 * "QA Test Co" (marked internal). Their runs and Leads count in run and Lead quality tiles.
 */
export const NOW = new Date('2026-11-20T15:30:00.000Z');
const at = (iso: string) => new Date(iso);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const IDS = {
  staff: uuid(1),
  qa: uuid(2),
  sweet: uuid(3),
  corner: uuid(4),
  bagels: uuid(5),
  clean: uuid(6),
  bakery: uuid(7),
  r1: uuid(101),
  r2: uuid(102),
  r3: uuid(103),
  r4: uuid(104),
  r5: uuid(105),
  r6: uuid(106),
  p1: uuid(111),
  p2: uuid(112),
  old: uuid(120),
} as const;

function run(over: Partial<RunFact> & Pick<RunFact, 'runId' | 'businessId' | 'queuedAt'>): RunFact {
  return {
    status: 'completed',
    startedAt: over.queuedAt,
    finishedAt: null,
    creditsSpent: 0,
    maxCredits: 400,
    providerCostMicros: 0,
    leadsDelivered: 0,
    icpEdited: false,
    failureCode: null,
    ...over,
  };
}

let leadSeq = 0;
/** `n` Leads of a run: the first `good` marked good, the next `notFit` not a fit. */
function leadsOf(
  r: RunFact,
  n: number,
  opts: { good: number; notFit: number; contacts: WorldLead['contacts'] },
): WorldLead[] {
  return Array.from({ length: n }, (_, i) => ({
    id: uuid(10_000 + ++leadSeq),
    businessId: r.businessId,
    runId: r.runId,
    deliveredAt: r.finishedAt ?? r.queuedAt,
    feedback: i < opts.good ? 'good' : i < opts.good + opts.notFit ? 'not_fit' : null,
    contacts: opts.contacts,
  }));
}

function calls(
  toolKey: string,
  when: Date,
  n: number,
  opts: { costMicros: number; errors: number },
): WorldToolCall[] {
  return Array.from({ length: n }, (_, i) => ({
    toolKey,
    at: when,
    providerCostMicros: opts.costMicros,
    status: i < opts.errors ? ('error' as const) : ('ok' as const),
    reused: false,
  }));
}

export function dashboardWorld(): World {
  leadSeq = 0;
  const b = (
    id: string,
    name: string,
    ownerEmail: string,
    signedUp: string,
    verified: string | null,
    over: { internal?: boolean; ownerIsStaff?: boolean; lastActiveAt?: string } = {},
  ) => ({
    id,
    name,
    ownerEmail,
    internal: over.internal ?? false,
    ownerIsStaff: over.ownerIsStaff ?? false,
    signedUpAt: at(signedUp),
    verifiedAt: verified ? at(verified) : null,
    lastActiveAt: over.lastActiveAt ? at(over.lastActiveAt) : null,
  });

  const r1 = run({
    runId: IDS.r1,
    businessId: IDS.sweet,
    queuedAt: at('2026-11-10T10:00:00Z'),
    finishedAt: at('2026-11-10T10:20:00Z'),
    creditsSpent: 137,
    providerCostMicros: 412_000,
    leadsDelivered: 25,
  });
  const r2 = run({
    runId: IDS.r2,
    businessId: IDS.corner,
    queuedAt: at('2026-11-12T09:00:00Z'),
    finishedAt: at('2026-11-12T10:30:00Z'),
    creditsSpent: 200,
    providerCostMicros: 600_000,
    leadsDelivered: 20,
    icpEdited: true,
  });
  const r3 = run({
    runId: IDS.r3,
    businessId: IDS.staff,
    queuedAt: at('2026-11-15T08:00:00Z'),
    finishedAt: at('2026-11-15T08:40:00Z'),
    creditsSpent: 300,
    maxCredits: 250,
    providerCostMicros: 900_000,
    leadsDelivered: 30,
  });
  const r4 = run({
    runId: IDS.r4,
    businessId: IDS.clean,
    status: 'failed',
    queuedAt: at('2026-11-18T12:00:00Z'),
    finishedAt: at('2026-11-18T12:50:00Z'),
    maxCredits: 50,
    providerCostMicros: 88_000,
    failureCode: 'PROVIDER_ERROR',
  });
  const r5 = run({
    runId: IDS.r5,
    businessId: IDS.corner,
    status: 'cancelled',
    queuedAt: at('2026-11-19T08:00:00Z'),
    finishedAt: at('2026-11-19T08:10:00Z'),
    creditsSpent: 40,
    providerCostMicros: 150_000,
  });
  const r6 = run({
    runId: IDS.r6,
    businessId: IDS.sweet,
    status: 'running',
    queuedAt: at('2026-11-20T14:00:00Z'),
    icpEdited: true,
  });
  const p1 = run({
    runId: IDS.p1,
    businessId: IDS.sweet,
    queuedAt: at('2026-10-05T10:00:00Z'),
    finishedAt: at('2026-10-05T10:30:00Z'),
    creditsSpent: 100,
    providerCostMicros: 250_000,
    leadsDelivered: 20,
  });
  const p2 = run({
    runId: IDS.p2,
    businessId: IDS.staff,
    status: 'failed',
    queuedAt: at('2026-10-10T09:00:00Z'),
    finishedAt: at('2026-10-10T09:10:00Z'),
    providerCostMicros: 50_000,
    failureCode: 'TIME_LIMIT',
  });
  // Before both windows: must not count anywhere.
  const old = run({
    runId: IDS.old,
    businessId: IDS.sweet,
    queuedAt: at('2026-09-01T10:00:00Z'),
    finishedAt: at('2026-09-01T10:10:00Z'),
    creditsSpent: 999,
    providerCostMicros: 9_990_000,
    leadsDelivered: 5,
  });

  const phoneAndEmail = (phone: boolean, email: boolean) => [
    { type: 'phone' as const, verified: phone },
    { type: 'email' as const, verified: email },
  ];

  return {
    businesses: [
      b(
        IDS.staff,
        'Llyner Leads (internal)',
        'staff@demo.test',
        '2026-08-01T00:00:00Z',
        '2026-08-01T00:00:00Z',
        {
          internal: true,
          ownerIsStaff: true,
          lastActiveAt: '2026-11-20T12:00:00Z',
        },
      ),
      b(IDS.qa, 'QA Test Co', 'qa@demo.test', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', {
        internal: true,
      }),
      b(
        IDS.sweet,
        'Sweet Supply Co',
        'owner@demo.test',
        '2026-09-01T00:00:00Z',
        '2026-09-01T00:00:00Z',
        {
          lastActiveAt: '2026-11-20T14:00:00Z',
        },
      ),
      b(
        IDS.corner,
        'Corner Coffee Roasters',
        'low@demo.test',
        '2026-10-01T00:00:00Z',
        '2026-10-02T00:00:00Z',
        {
          lastActiveAt: '2026-11-19T08:00:00Z',
        },
      ),
      b(
        IDS.bagels,
        'Austin Bagels',
        'bagels@demo.test',
        '2026-10-10T00:00:00Z',
        '2026-10-10T00:00:00Z',
      ),
      b(
        IDS.clean,
        'Clean Desk Co',
        'new@demo.test',
        '2026-11-18T09:00:00Z',
        '2026-11-18T09:30:00Z',
        {
          lastActiveAt: '2026-11-18T12:00:00Z',
        },
      ),
      b(IDS.bakery, 'Bakery Supplies Ltd', 'bakery@demo.test', '2026-11-19T09:00:00Z', null),
    ],
    runs: [r1, r2, r3, r4, r5, r6, p1, p2, old],
    leads: [
      ...leadsOf(r1, 25, { good: 5, notFit: 1, contacts: phoneAndEmail(true, false) }),
      ...leadsOf(r2, 20, { good: 3, notFit: 1, contacts: phoneAndEmail(true, true) }),
      ...leadsOf(r3, 30, { good: 10, notFit: 0, contacts: [{ type: 'phone', verified: true }] }),
      ...leadsOf(p1, 20, { good: 4, notFit: 4, contacts: phoneAndEmail(true, true) }),
      ...leadsOf(old, 5, { good: 5, notFit: 0, contacts: phoneAndEmail(true, true) }),
    ],
    ledger: [
      { businessId: IDS.staff, type: 'grant', credits: 10_000, at: at('2026-11-02T00:00:00Z') },
      { businessId: IDS.staff, type: 'settlement', credits: -300, at: at('2026-11-15T08:40:00Z') },
      { businessId: IDS.qa, type: 'purchase', credits: 2_500, at: at('2026-11-03T00:00:00Z') },
      { businessId: IDS.sweet, type: 'grant', credits: 50, at: at('2026-09-01T00:00:00Z') },
      { businessId: IDS.sweet, type: 'purchase', credits: 2_500, at: at('2026-10-01T00:00:00Z') },
      { businessId: IDS.sweet, type: 'settlement', credits: -100, at: at('2026-10-05T10:30:00Z') },
      { businessId: IDS.sweet, type: 'settlement', credits: -137, at: at('2026-11-10T10:20:00Z') },
      { businessId: IDS.corner, type: 'grant', credits: 50, at: at('2026-10-02T00:00:00Z') },
      { businessId: IDS.corner, type: 'purchase', credits: 11_000, at: at('2026-11-05T00:00:00Z') },
      { businessId: IDS.corner, type: 'settlement', credits: -200, at: at('2026-11-12T10:30:00Z') },
      { businessId: IDS.corner, type: 'settlement', credits: -40, at: at('2026-11-19T08:10:00Z') },
      { businessId: IDS.bagels, type: 'grant', credits: 50, at: at('2026-10-10T00:00:00Z') },
      { businessId: IDS.clean, type: 'grant', credits: 50, at: at('2026-11-18T09:30:00Z') },
      { businessId: IDS.clean, type: 'adjustment', credits: 1_000, at: at('2026-11-19T00:00:00Z') },
      { businessId: IDS.clean, type: 'adjustment', credits: -100, at: at('2026-11-19T01:00:00Z') },
    ],
    purchases: [
      {
        businessId: IDS.qa,
        credits: 2_500,
        amountCents: 2_500,
        paidAt: at('2026-11-03T00:00:00Z'),
      },
      {
        businessId: IDS.sweet,
        credits: 2_500,
        amountCents: 2_500,
        paidAt: at('2026-10-01T00:00:00Z'),
      },
      {
        businessId: IDS.corner,
        credits: 11_000,
        amountCents: 10_000,
        paidAt: at('2026-11-05T00:00:00Z'),
      },
    ],
    reservations: [
      { businessId: IDS.sweet, runId: IDS.r6, credits: 400, status: 'open' },
      { businessId: IDS.sweet, runId: IDS.r1, credits: 400, status: 'settled' },
    ],
    toolCalls: [
      ...calls('google.places-text-search', at('2026-11-10T10:05:00Z'), 40, {
        costMicros: 30_000,
        errors: 2,
      }),
      ...calls('hunter.domain-search', at('2026-11-12T09:30:00Z'), 10, {
        costMicros: 5_000,
        errors: 5,
      }),
      ...calls('firecrawl.scrape', at('2026-10-05T10:10:00Z'), 3, { costMicros: 1_000, errors: 0 }),
      // Reused and skipped calls cost nothing and are not provider calls.
      {
        toolKey: 'hunter.domain-search',
        at: at('2026-11-12T09:31:00Z'),
        providerCostMicros: 0,
        status: 'ok',
        reused: true,
      },
      {
        toolKey: 'hunter.domain-search',
        at: at('2026-11-12T09:32:00Z'),
        providerCostMicros: 0,
        status: 'skipped',
        reused: false,
      },
    ],
  };
}

/** The dashboard dashboardWorld() must produce for period 30d at NOW (worked out by hand). */
export const EXPECTED_DASHBOARD: Dashboard = {
  period: '30d',
  customers: {
    total: { value: 5, previous: 3 },
    newSignups: {
      value: 2,
      previous: 2,
      // 2026-10-22 … 2026-11-20; Clean Desk signed up on the 18th, Bakery Supplies on the 19th.
      byDay: Array.from({ length: 30 }, (_, i) => {
        const date = new Date(Date.UTC(2026, 9, 22 + i)).toISOString().slice(0, 10);
        return { date, count: date === '2026-11-18' || date === '2026-11-19' ? 1 : 0 };
      }),
    },
    verified: { value: 4, previous: 3 },
    active: { value: 3, previous: 1 },
    paying: { value: 2, previous: 1 },
    trialToPaidPct: { value: 66.7, previous: 50 },
  },
  revenue: {
    packRevenue: {
      value: { cents: 10_000, currency: 'usd' },
      previous: { cents: 2_500, currency: 'usd' },
    },
    creditsGranted: { value: 1_050, previous: 100 },
    creditsPurchased: { value: 11_000, previous: 2_500 },
    creditsSpent: { value: 377, previous: 100 },
    unspentCredits: { value: 13_723, previous: null },
  },
  runs: {
    started: { value: 6, previous: 2 },
    completedPct: { value: 75, previous: 50 },
    withinLimitsPct: { value: 25, previous: 50 },
    medianDurationS: { value: 2_400, previous: 1_800 },
    avgCredits: { value: 135.4, previous: 50 },
    failed: [
      {
        runId: IDS.r4,
        businessName: 'Clean Desk Co',
        failureReason: 'PROVIDER_ERROR',
        at: '2026-11-18T12:50:00.000Z',
      },
    ],
  },
  leads: {
    delivered: { value: 75, previous: 20 },
    goodPct: { value: 90, previous: 50 },
    verifiedPct: { value: 79.2, previous: 100 },
    providerCostPerLeadCents: { value: 2.87, previous: 1.5 },
    creditsPerLead: { value: 9, previous: 5 },
    grossMarginPct: { value: 68.2, previous: 70 },
  },
  plans: { noIcpEditPct: { value: 66.7, previous: 100 } },
  northStar: { goodLeadsPerActiveBusinessPerWeek: { value: 1.05, previous: 0.47 } },
  providers: [
    { toolKey: 'google.places-text-search', spendCents: 120, errorRatePct: 5 },
    { toolKey: 'hunter.domain-search', spendCents: 5, errorRatePct: 50 },
  ],
  topBusinesses: [
    { id: IDS.corner, name: 'Corner Coffee Roasters', creditsSpent: 240 },
    { id: IDS.sweet, name: 'Sweet Supply Co', creditsSpent: 137 },
  ],
  latestSignups: [
    {
      id: IDS.bakery,
      name: 'Bakery Supplies Ltd',
      ownerEmail: 'bakery@demo.test',
      createdAt: '2026-11-19T09:00:00.000Z',
    },
    {
      id: IDS.clean,
      name: 'Clean Desk Co',
      ownerEmail: 'new@demo.test',
      createdAt: '2026-11-18T09:00:00.000Z',
    },
    {
      id: IDS.bagels,
      name: 'Austin Bagels',
      ownerEmail: 'bagels@demo.test',
      createdAt: '2026-10-10T00:00:00.000Z',
    },
    {
      id: IDS.corner,
      name: 'Corner Coffee Roasters',
      ownerEmail: 'low@demo.test',
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: IDS.sweet,
      name: 'Sweet Supply Co',
      ownerEmail: 'owner@demo.test',
      createdAt: '2026-09-01T00:00:00.000Z',
    },
  ],
};
