import type { RunFact, RunStatus } from '../domain/metrics.js';
import { DAY_MS } from '../domain/period.js';
import type { World, WorldLead, WorldToolCall } from './world.js';

/** Deterministic pseudo-random numbers (LCG), so the volume test is the same every time. */
function random(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return s / 4_294_967_296;
  };
}

const uuid = (kind: number, n: number) =>
  `${String(kind).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;

const TOOL_KEYS = [
  'google.places-text-search',
  'apify.google-maps',
  'osm.overpass',
  'firecrawl.scrape',
  'apify.instagram-profile',
  'apollo.people-match',
  'hunter.domain-search',
  'zerobounce.validate',
  'twilio.lookup-line-type',
  'claude.fast',
  'claude.planning',
];

/**
 * NFR-1 volume: 100 Businesses, 2,000 runs over 180 days (both 90-day periods full), 29 Leads per
 * completed run (51,040 Leads, 102,080 Contacts), 50 Tool calls per run (100,000), a ledger entry
 * per run. Past the PRD's first-3-months volume (< 500 runs, < 50,000 Leads).
 */
export function performanceWorld(now: Date, sizes = { businesses: 100, runs: 2_000 }): World {
  const rnd = random(42);
  const world: World = {
    businesses: [],
    runs: [],
    leads: [],
    ledger: [],
    purchases: [],
    reservations: [],
    toolCalls: [],
  };
  const daysAgo = (d: number) => new Date(now.getTime() - d * DAY_MS);

  for (let i = 1; i <= sizes.businesses; i++) {
    const signedUpAt = daysAgo(Math.floor(rnd() * 200) + 1);
    const id = uuid(1, i);
    world.businesses.push({
      id,
      name: `Business ${i}`,
      ownerEmail: `owner${i}@perf.test`,
      internal: i <= 2,
      ownerIsStaff: i === 1,
      signedUpAt,
      verifiedAt: rnd() < 0.8 ? signedUpAt : null,
      lastActiveAt: daysAgo(rnd() * 10),
    });
    world.ledger.push({ businessId: id, type: 'grant', credits: 50, at: signedUpAt });
    if (i % 3 === 0) {
      world.purchases.push({
        businessId: id,
        credits: 2_500,
        amountCents: 2_500,
        paidAt: signedUpAt,
      });
      world.ledger.push({ businessId: id, type: 'purchase', credits: 2_500, at: signedUpAt });
    }
  }

  let leadN = 0;
  for (let i = 1; i <= sizes.runs; i++) {
    const businessId = uuid(1, 1 + Math.floor(rnd() * sizes.businesses));
    const queuedAt = daysAgo(rnd() * 180);
    const status: RunStatus = i % 10 === 0 ? 'failed' : i % 25 === 0 ? 'cancelled' : 'completed';
    const leadsDelivered = status === 'completed' ? 29 : 0;
    const run: RunFact = {
      runId: uuid(2, i),
      businessId,
      status,
      queuedAt,
      startedAt: queuedAt,
      finishedAt: new Date(queuedAt.getTime() + (10 + rnd() * 70) * 60_000),
      creditsSpent: status === 'failed' ? 0 : 100 + Math.floor(rnd() * 200),
      maxCredits: 400,
      providerCostMicros: 200_000 + Math.floor(rnd() * 800_000),
      leadsDelivered,
      icpEdited: rnd() < 0.3,
      failureCode: status === 'failed' ? 'PROVIDER_ERROR' : null,
    };
    world.runs.push(run);
    if (run.creditsSpent > 0) {
      world.ledger.push({
        businessId,
        type: 'settlement',
        credits: -run.creditsSpent,
        at: run.finishedAt ?? queuedAt,
      });
    }
    world.reservations.push({ businessId, runId: run.runId, credits: 400, status: 'settled' });
    for (let l = 0; l < leadsDelivered; l++) {
      const r = rnd();
      const lead: WorldLead = {
        id: uuid(3, ++leadN),
        businessId,
        runId: run.runId,
        deliveredAt: run.finishedAt ?? queuedAt,
        feedback: r < 0.2 ? 'good' : r < 0.25 ? 'not_fit' : null,
        contacts: [
          { type: 'phone', verified: rnd() < 0.85 },
          { type: 'email', verified: rnd() < 0.7 },
        ],
      };
      world.leads.push(lead);
    }
    for (let c = 0; c < 50; c++) {
      const call: WorldToolCall = {
        toolKey: TOOL_KEYS[c % TOOL_KEYS.length] ?? 'osm.overpass',
        at: new Date(queuedAt.getTime() + c * 30_000),
        providerCostMicros: 1_000 + Math.floor(rnd() * 20_000),
        status: rnd() < 0.03 ? 'error' : 'ok',
        reused: false,
      };
      world.toolCalls.push(call);
    }
  }
  return world;
}
