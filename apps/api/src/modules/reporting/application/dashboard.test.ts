import { dashboard as dashboardContract } from '@app/contracts/reporting';
import { describe, expect, test } from 'vitest';
import { ForbiddenError } from '../../../shared/domain/errors.js';
import { dashboardWorld, EXPECTED_DASHBOARD, IDS, NOW } from '../test/fixture.js';
import { fakeDeps, ownerActor, staffActor } from '../test/fakes.js';
import { emptyWorld } from '../test/world.js';
import { GetDashboard } from './get-dashboard.js';

describe('FR-30: Staff dashboard', () => {
  test('every number matches the hand-computed fixture, with the previous period', async () => {
    const result = await new GetDashboard(fakeDeps(dashboardWorld())).execute({
      actor: staffActor,
      period: '30d',
    });
    expect(dashboardContract.parse(result)).toEqual(result);
    expect(result).toEqual(EXPECTED_DASHBOARD);
  });

  test("Staff's own and internal Businesses leave customer and revenue tiles, not run tiles", async () => {
    const world = dashboardWorld();
    const before = await new GetDashboard(fakeDeps(world)).execute({
      actor: staffActor,
      period: '30d',
    });
    // Corner becomes internal: it leaves customers, revenue and tables …
    world.businesses = world.businesses.map((b) =>
      b.id === IDS.corner ? { ...b, internal: true } : b,
    );
    const after = await new GetDashboard(fakeDeps(world)).execute({
      actor: staffActor,
      period: '30d',
    });
    expect(after.customers.total.value).toBe(4);
    expect(after.customers.active.value).toBe(2);
    expect(after.customers.paying.value).toBe(1);
    expect(after.revenue.packRevenue.value).toEqual({ cents: 0, currency: 'usd' });
    expect(after.revenue.creditsSpent.value).toBe(137);
    expect(after.topBusinesses.map((t) => t.id)).toEqual([IDS.sweet]);
    expect(after.latestSignups.map((s) => s.id)).not.toContain(IDS.corner);
    // … but its runs and Leads still count.
    expect(after.runs).toEqual(before.runs);
    expect(after.leads).toEqual(before.leads);
    expect(after.plans).toEqual(before.plans);
    expect(after.northStar).toEqual(before.northStar);
  });

  test('no data: counts are 0 and every rate is null ("—")', async () => {
    const result = await new GetDashboard(fakeDeps(emptyWorld())).execute({
      actor: staffActor,
      period: '7d',
    });
    expect(dashboardContract.parse(result)).toEqual(result);
    expect(result.customers.total).toEqual({ value: 0, previous: 0 });
    expect(result.customers.newSignups.byDay).toHaveLength(7);
    expect(result.customers.trialToPaidPct).toEqual({ value: null, previous: null });
    expect(result.runs.completedPct).toEqual({ value: null, previous: null });
    expect(result.runs.medianDurationS).toEqual({ value: null, previous: null });
    expect(result.leads.goodPct).toEqual({ value: null, previous: null });
    expect(result.leads.grossMarginPct).toEqual({ value: null, previous: null });
    expect(result.plans.noIcpEditPct).toEqual({ value: null, previous: null });
    expect(result.northStar.goodLeadsPerActiveBusinessPerWeek).toEqual({
      value: null,
      previous: null,
    });
    expect(result.providers).toEqual([]);
    expect(result.topBusinesses).toEqual([]);
  });

  test('7d compares with the 7 days before', async () => {
    const result = await new GetDashboard(fakeDeps(dashboardWorld())).execute({
      actor: staffActor,
      period: '7d',
    });
    // [2026-11-14, 2026-11-21): r3, r4, r5, r6; the week before: r1, r2.
    expect(result.runs.started).toEqual({ value: 4, previous: 2 });
    expect(result.customers.newSignups).toMatchObject({ value: 2, previous: 0 });
  });

  test('an unknown failure code shows no reason', async () => {
    const world = dashboardWorld();
    world.runs = world.runs.map((r) =>
      r.runId === IDS.r4 ? { ...r, failureCode: 'SOMETHING_NEW' } : r,
    );
    const result = await new GetDashboard(fakeDeps(world)).execute({
      actor: staffActor,
      period: '30d',
    });
    expect(result.runs.failed[0]?.failureReason).toBeNull();
  });

  test('only Staff', async () => {
    const usecase = new GetDashboard(fakeDeps(dashboardWorld(), NOW));
    await expect(usecase.execute({ actor: ownerActor, period: '30d' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(usecase.execute({ actor: null, period: '30d' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
