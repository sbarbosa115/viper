import { describe, expect, test } from 'vitest';
import {
  customerCounts,
  isCustomer,
  latestSignups,
  signupsByDay,
  type BusinessFact,
} from './customers.js';
import {
  activeBusinessIds,
  failedRuns,
  goodLeadsPerActiveBusinessPerWeek,
  isWithinLimits,
  median,
  percent,
  providerRows,
  runMetrics,
  topBusinessesByCredits,
  type RunFact,
} from './metrics.js';
import { daysIn, periodWindows } from './period.js';

const NOW = new Date('2026-11-20T15:30:00.000Z');
const at = (iso: string) => new Date(iso);

function run(over: Partial<RunFact> = {}): RunFact {
  return {
    runId: 'r1',
    businessId: 'b1',
    status: 'completed',
    queuedAt: at('2026-11-10T10:00:00Z'),
    startedAt: at('2026-11-10T10:00:00Z'),
    finishedAt: at('2026-11-10T10:30:00Z'),
    creditsSpent: 100,
    maxCredits: 400,
    providerCostMicros: 300_000,
    leadsDelivered: 10,
    icpEdited: false,
    failureCode: null,
    ...over,
  };
}

function business(over: Partial<BusinessFact> = {}): BusinessFact {
  return {
    id: 'b1',
    name: 'Sweet Supply Co',
    ownerEmail: 'owner@demo.test',
    internal: false,
    ownerIsStaff: false,
    signedUpAt: at('2026-10-01T00:00:00Z'),
    verifiedAt: at('2026-10-01T01:00:00Z'),
    ...over,
  };
}

describe('FR-30: period windows', () => {
  test('30d covers the last 30 UTC days with today, the previous 30 days before', () => {
    const w = periodWindows('30d', NOW);
    expect(w.days).toBe(30);
    expect(w.current).toEqual({
      from: at('2026-10-22T00:00:00Z'),
      to: at('2026-11-21T00:00:00Z'),
    });
    expect(w.previous).toEqual({
      from: at('2026-09-22T00:00:00Z'),
      to: at('2026-10-22T00:00:00Z'),
    });
  });

  test('7d and 90d; one bar per day', () => {
    expect(periodWindows('7d', NOW).current.from).toEqual(at('2026-11-14T00:00:00Z'));
    expect(periodWindows('90d', NOW).previous.from).toEqual(at('2026-05-25T00:00:00Z'));
    const days = daysIn(periodWindows('7d', NOW).current);
    expect(days).toEqual([
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
    ]);
  });
});

describe('FR-30: arithmetic helpers', () => {
  test('percent rounds to 1 decimal and is null without a denominator', () => {
    expect(percent(2, 3)).toBe(66.7);
    expect(percent(0, 0)).toBeNull();
  });

  test('median of odd, even and empty lists', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('FR-30: runs tile', () => {
  test('a run is within limits when completed within 60 minutes and its budget', () => {
    expect(isWithinLimits(run())).toBe(true);
    expect(isWithinLimits(run({ finishedAt: at('2026-11-10T11:00:00Z') }))).toBe(true);
    expect(isWithinLimits(run({ finishedAt: at('2026-11-10T11:00:01Z') }))).toBe(false);
    expect(isWithinLimits(run({ creditsSpent: 401 }))).toBe(false);
    expect(isWithinLimits(run({ status: 'failed' }))).toBe(false);
  });

  test('started, completed %, within limits %, median duration, average credits', () => {
    const runs = [
      run({ runId: 'a', finishedAt: at('2026-11-10T10:20:00Z') }), // 20 min, within
      run({ runId: 'b', finishedAt: at('2026-11-10T11:30:00Z') }), // 90 min, not within
      run({ runId: 'c', status: 'failed', creditsSpent: 0, leadsDelivered: 0 }),
      run({ runId: 'd', status: 'cancelled', creditsSpent: 40, leadsDelivered: 0 }),
      run({ runId: 'e', status: 'running', finishedAt: null, creditsSpent: 0, leadsDelivered: 0 }),
    ];
    const m = runMetrics(runs);
    expect(m.started).toBe(5);
    expect(m.completedPct).toBe(66.7); // 2 of 3 (cancelled and running left out)
    expect(m.withinLimitsPct).toBe(33.3); // 1 of 3
    expect(m.medianDurationS).toBe(3300); // (1200 + 5400) / 2
    expect(m.avgCredits).toBe(60); // (100 + 100 + 0 + 40) / 4 finished runs
  });

  test('cost per Lead, credits per Lead and gross margin over finished runs', () => {
    const m = runMetrics([
      run({ runId: 'a', creditsSpent: 137, providerCostMicros: 412_000, leadsDelivered: 25 }),
      run({
        runId: 'b',
        status: 'failed',
        creditsSpent: 0,
        providerCostMicros: 88_000,
        leadsDelivered: 0,
      }),
    ]);
    // 500,000 micros = 50 cents over 25 Leads
    expect(m.providerCostPerLeadCents).toBe(2);
    expect(m.creditsPerLead).toBe(5.5); // 137 / 25 = 5.48
    // 1 − 500,000 / (137 × 10,000) = 63.5%
    expect(m.grossMarginPct).toBe(63.5);
  });

  test('no runs: every rate is null ("—"), started is 0', () => {
    expect(runMetrics([])).toEqual({
      started: 0,
      completedPct: null,
      withinLimitsPct: null,
      medianDurationS: null,
      avgCredits: null,
      providerCostPerLeadCents: null,
      creditsPerLead: null,
      grossMarginPct: null,
      noIcpEditPct: null,
    });
  });

  test('G-4: % of runs started from Plans with no ICP edits', () => {
    const m = runMetrics([
      run({ runId: 'a' }),
      run({ runId: 'b', icpEdited: true }),
      run({ runId: 'c' }),
      run({ runId: 'd', icpEdited: true }),
    ]);
    expect(m.noIcpEditPct).toBe(50);
  });

  test('failed runs list is newest first and capped', () => {
    const runs = [
      run({ runId: 'old', status: 'failed', finishedAt: at('2026-11-01T00:00:00Z') }),
      run({ runId: 'new', status: 'failed', finishedAt: at('2026-11-05T00:00:00Z') }),
      run({ runId: 'ok' }),
    ];
    expect(failedRuns(runs, 10).map((r) => r.runId)).toEqual(['new', 'old']);
    expect(failedRuns(runs, 1).map((r) => r.runId)).toEqual(['new']);
  });

  test('top Businesses by credits spent skip excluded Businesses and zero spend', () => {
    const runs = [
      run({ runId: '1', businessId: 'b1', creditsSpent: 50 }),
      run({ runId: '2', businessId: 'b1', creditsSpent: 70 }),
      run({ runId: '3', businessId: 'b2', creditsSpent: 300 }),
      run({ runId: '4', businessId: 'staff', creditsSpent: 900 }),
      run({ runId: '5', businessId: 'b3', creditsSpent: 0 }),
    ];
    expect(topBusinessesByCredits(runs, (id) => id !== 'staff', 10)).toEqual([
      { businessId: 'b2', creditsSpent: 300 },
      { businessId: 'b1', creditsSpent: 120 },
    ]);
    expect(activeBusinessIds(runs)).toEqual(new Set(['b1', 'b2', 'staff', 'b3']));
  });

  test('north star: Good leads per active Business per week', () => {
    // 60 good Leads, 2 active Businesses, 30 days = 4.29 weeks → 7
    expect(goodLeadsPerActiveBusinessPerWeek(60, 2, 30)).toBe(7);
    expect(goodLeadsPerActiveBusinessPerWeek(10, 3, 7)).toBe(3.33);
    expect(goodLeadsPerActiveBusinessPerWeek(10, 0, 30)).toBeNull();
  });
});

describe('FR-30: providers tile', () => {
  test('spend in cents and error rate per Tool, most spend first', () => {
    expect(
      providerRows([
        { toolKey: 'hunter.domain-search', providerCostMicros: 15_000, calls: 4, errors: 1 },
        {
          toolKey: 'google.places-text-search',
          providerCostMicros: 1_234_567,
          calls: 40,
          errors: 0,
        },
        { toolKey: 'osm.overpass', providerCostMicros: 0, calls: 0, errors: 0 },
      ]),
    ).toEqual([
      { toolKey: 'google.places-text-search', spendCents: 123.46, errorRatePct: 0 },
      { toolKey: 'hunter.domain-search', spendCents: 1.5, errorRatePct: 25 },
      { toolKey: 'osm.overpass', spendCents: 0, errorRatePct: null },
    ]);
  });
});

describe('FR-30: customers tile', () => {
  const w = periodWindows('30d', NOW);

  test("Staff's own and internal Businesses are not customers", () => {
    expect(isCustomer(business())).toBe(true);
    expect(isCustomer(business({ internal: true }))).toBe(false);
    expect(isCustomer(business({ ownerIsStaff: true }))).toBe(false);
  });

  test('total, new sign-ups, verified, active, paying and trial-to-paid for a window', () => {
    const customers = [
      // old, verified, paying, active
      business({
        id: 'a',
        signedUpAt: at('2026-09-01T00:00:00Z'),
        verifiedAt: at('2026-09-01T00:00:00Z'),
      }),
      // old, verified, not paying
      business({
        id: 'b',
        signedUpAt: at('2026-09-10T00:00:00Z'),
        verifiedAt: at('2026-09-10T00:00:00Z'),
      }),
      // new in window, verified 2 days ago (too young for trial-to-paid), active
      business({
        id: 'c',
        signedUpAt: at('2026-11-18T09:00:00Z'),
        verifiedAt: at('2026-11-18T10:00:00Z'),
      }),
      // new in window, unverified
      business({ id: 'd', signedUpAt: at('2026-11-19T09:00:00Z'), verifiedAt: null }),
    ];
    const counts = customerCounts(customers, w.current, {
      activeIds: new Set(['a', 'c', 'someone-else']),
      payingIds: new Set(['a']),
    });
    expect(counts).toEqual({
      total: 4,
      newSignups: 2,
      verified: 3,
      active: 2,
      paying: 1,
      trialToPaidPct: 50, // a and b are old enough and verified; a pays
    });
    const previous = customerCounts(customers, w.previous, {
      activeIds: new Set(['b']),
      payingIds: new Set(),
    });
    expect(previous).toEqual({
      total: 2,
      newSignups: 0, // a and b signed up before the previous window
      verified: 2,
      active: 1,
      paying: 0,
      trialToPaidPct: 0, // both old enough and verified, neither paid yet
    });
  });

  test('sign-ups by day include zero days and only the window', () => {
    const customers = [
      business({ id: 'a', signedUpAt: at('2026-11-14T00:00:00Z') }),
      business({ id: 'b', signedUpAt: at('2026-11-14T23:59:59Z') }),
      business({ id: 'c', signedUpAt: at('2026-11-20T12:00:00Z') }),
      business({ id: 'd', signedUpAt: at('2026-11-13T23:59:59Z') }),
    ];
    const byDay = signupsByDay(customers, periodWindows('7d', NOW).current);
    expect(byDay).toHaveLength(7);
    expect(byDay[0]).toEqual({ date: '2026-11-14', count: 2 });
    expect(byDay[6]).toEqual({ date: '2026-11-20', count: 1 });
    expect(byDay.slice(1, 6).every((d) => d.count === 0)).toBe(true);
  });

  test('latest sign-ups are newest first', () => {
    const customers = [
      business({ id: 'a', signedUpAt: at('2026-11-01T00:00:00Z') }),
      business({ id: 'b', signedUpAt: at('2026-11-03T00:00:00Z') }),
      business({ id: 'c', signedUpAt: at('2026-11-02T00:00:00Z') }),
    ];
    expect(latestSignups(customers, 2).map((c) => c.id)).toEqual(['b', 'c']);
  });
});
