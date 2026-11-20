import { errorResponse } from '@app/contracts/errors';
import { listPlans, plan as planContract, searchPlaces } from '@app/contracts/planning';
import { describe, expect, test } from 'vitest';
import { buildTestApp } from '../../../../test/build-test-app.js';
import { LlmUnavailableError } from '../../../shared/application/llm-client.js';
import type { Actor } from '../../../shared/domain/actor.js';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { FixtureGeocoder } from '../../../shared/infrastructure/geo/fixture-geocoder.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import { createInMemoryPlanning } from '../index.js';
import {
  actingAs,
  BAKERIES_GOAL,
  bakeriesDraft,
  BUSINESS,
  CANE_SUGAR,
  draftReply,
  FakePlanActivity,
  FakeProfiles,
  FakeRunStats,
  FakeWallet,
  otherOwner,
  owner,
  ScriptedLlm,
  sweetSupplyProfile,
  SWEET_SUPPLY_LOCATION,
  UNKNOWN_ID,
} from '../test/planning-fixture.js';

async function setup(actor?: Actor) {
  const llm = new ScriptedLlm();
  const profiles = new FakeProfiles();
  const wallet = new FakeWallet();
  const analytics = new RecordingAnalyticsTracker();
  const planning = createInMemoryPlanning({
    clock: new FixedClock(new Date('2026-11-19T10:00:00.000Z')),
    ids: new SequentialIdGenerator(),
    analytics,
    llm,
    geocoder: new FixtureGeocoder(),
    profiles,
    wallet,
    runStats: new FakeRunStats(),
    activity: new FakePlanActivity(),
  });
  const app = await buildTestApp({ modules: [planning.module], ...(actor ? { actor } : {}) });
  /** Creates the bakeries Plan through the use case (as `owner()` unless told otherwise). */
  const seedPlan = async (as: Actor = owner()) => {
    llm.reply(draftReply(bakeriesDraft()));
    return (await planning.application.createPlan.execute(as, BAKERIES_GOAL)).plan;
  };
  return { app, planning, llm, profiles, wallet, analytics, seedPlan };
}

const code = (body: unknown) => errorResponse.parse(body).error.code;
const fields = (body: unknown) => errorResponse.parse(body).error.fields;

describe('auth', () => {
  test('401 on every planning endpoint when not signed in', async () => {
    const { app } = await setup();
    const requests = [
      { method: 'POST', url: '/api/plans', payload: { goal: BAKERIES_GOAL } },
      { method: 'GET', url: '/api/plans' },
      { method: 'GET', url: `/api/plans/${UNKNOWN_ID}` },
      { method: 'PATCH', url: `/api/plans/${UNKNOWN_ID}`, payload: { name: 'x' } },
      { method: 'GET', url: '/api/places/search?q=Austin' },
    ] as const;
    for (const r of requests) {
      const res = await app.inject(r);
      expect(res.statusCode, r.url).toBe(401);
    }
  });
});

describe('FR-16: POST /api/plans', () => {
  test('AC: 201 with the Bakeries segment pitching the sugar, centre = profile point, radius 3, and the estimate', async () => {
    const { app, llm, analytics } = await setup(owner());
    llm.reply(draftReply(bakeriesDraft()));
    const res = await app.inject({
      method: 'POST',
      url: '/api/plans',
      payload: { goal: BAKERIES_GOAL },
    });
    expect(res.statusCode).toBe(201);
    const body = planContract.parse(res.json());
    expect(body.segments).toEqual([
      expect.objectContaining({ name: 'Bakeries', productId: CANE_SUGAR }),
    ]);
    expect(body.searchArea).toEqual({ ...SWEET_SUPPLY_LOCATION, radiusMiles: 3 });
    expect(body.guardrails).toEqual({ maxCredits: 400, maxLeads: 100, minFitScore: 60 });
    expect(body.estimate).toEqual({ maxCredits: 400, typicalCredits: 240 });
    expect(body.available).toBe(863);
    expect(body.icpEdited).toBe(false);
    expect(body.lastRun).toBeNull();
    expect(body.leadsCount).toBe(0);
    expect(body.warnings).toBeUndefined();
    expect(analytics.events.map((e) => e.name)).toEqual(['plan_created']);
  });

  test('AC: a trial Business with 50 available gets max credits 50', async () => {
    // Trial credits arrive with the verified email, which creating a Plan needs too.
    const { app, llm, wallet } = await setup(owner());
    wallet.balances.set(BUSINESS, 50);
    llm.reply(draftReply(bakeriesDraft()));
    const res = await app.inject({
      method: 'POST',
      url: '/api/plans',
      payload: { goal: BAKERIES_GOAL },
    });
    expect(res.statusCode).toBe(201);
    const body = planContract.parse(res.json());
    expect(body.guardrails.maxCredits).toBe(50);
    expect(body.available).toBe(50);
  });

  test('returns warnings for a place that cannot be geocoded', async () => {
    const { app, llm } = await setup(owner());
    llm.reply(draftReply(bakeriesDraft({ place: 'Atlantis' })));
    const res = await app.inject({
      method: 'POST',
      url: '/api/plans',
      payload: { goal: BAKERIES_GOAL },
    });
    expect(planContract.parse(res.json()).warnings).toEqual([
      "We couldn't find 'Atlantis', so we used your address.",
    ]);
  });

  test('400 for a goal under 5 or over 500 characters', async () => {
    const { app } = await setup(owner());
    for (const goal of ['abc', 'x'.repeat(501)]) {
      const res = await app.inject({ method: 'POST', url: '/api/plans', payload: { goal } });
      expect(res.statusCode).toBe(400);
      expect(fields(res.json())).toHaveProperty('goal');
    }
  });

  test('422 PROFILE_INCOMPLETE', async () => {
    const { app, profiles } = await setup(owner());
    profiles.profiles.set(BUSINESS, sweetSupplyProfile({ complete: false }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/plans',
      payload: { goal: BAKERIES_GOAL },
    });
    expect(res.statusCode).toBe(422);
    expect(code(res.json())).toBe('PROFILE_INCOMPLETE');
  });

  test('503 ASSISTANT_UNAVAILABLE when the model fails', async () => {
    const { app, llm } = await setup(owner());
    llm.reply(new LlmUnavailableError('timeout'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/plans',
      payload: { goal: BAKERIES_GOAL },
    });
    expect(res.statusCode).toBe(503);
    expect(code(res.json())).toBe('ASSISTANT_UNAVAILABLE');
  });

  test('Staff Acting as create the Plan in the target Business', async () => {
    const { app, llm, planning } = await setup(actingAs());
    llm.reply(draftReply(bakeriesDraft()));
    const res = await app.inject({
      method: 'POST',
      url: '/api/plans',
      payload: { goal: BAKERIES_GOAL },
    });
    expect(res.statusCode).toBe(201);
    expect(planning.store.all()[0]?.businessId).toBe(BUSINESS);
  });
});

describe('FR-17: GET and PATCH /api/plans/:id', () => {
  test('GET returns the Plan; PATCH renames it', async () => {
    const { app, seedPlan } = await setup(owner());
    const plan = await seedPlan();
    const got = await app.inject({ method: 'GET', url: `/api/plans/${plan.id}` });
    expect(got.statusCode).toBe(200);
    expect(planContract.parse(got.json()).name).toBe('Bakeries near Austin');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plans/${plan.id}`,
      payload: { name: 'East side bakeries' },
    });
    expect(res.statusCode).toBe(200);
    expect(planContract.parse(res.json()).name).toBe('East side bakeries');
  });

  test('AC: a radius of 30 → 400 naming searchArea.radiusMiles', async () => {
    const { app, seedPlan } = await setup(owner());
    const plan = await seedPlan();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plans/${plan.id}`,
      payload: { searchArea: { radiusMiles: 30 } },
    });
    expect(res.statusCode).toBe(400);
    expect(code(res.json())).toBe('VALIDATION_ERROR');
    expect(Object.keys(fields(res.json()) ?? {})).toEqual(['searchArea.radiusMiles']);
  });

  test('AC: changing a Fit signal sets icpEdited and it stays set', async () => {
    const { app, seedPlan, analytics } = await setup(owner());
    const plan = await seedPlan();
    const segment = plan.segments[0]!;
    const patch = (fitSignals: string[]) =>
      app.inject({
        method: 'PATCH',
        url: `/api/plans/${plan.id}`,
        payload: { segments: [{ ...segment, fitSignals }] },
      });
    expect(
      planContract.parse((await patch(['Bakes on site', 'Wholesale counter'])).json()).icpEdited,
    ).toBe(true);
    expect(planContract.parse((await patch(['Bakes on site'])).json()).icpEdited).toBe(true);
    expect(analytics.events.filter((e) => e.name === 'plan_icp_edited')).toHaveLength(1);
  });

  test('400 for guardrails above the flow limits, naming the field', async () => {
    const { app, seedPlan } = await setup(owner());
    const plan = await seedPlan();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plans/${plan.id}`,
      payload: { guardrails: { maxCredits: 5000, maxLeads: 100, minFitScore: 60 } },
    });
    expect(res.statusCode).toBe(400);
    expect(fields(res.json())).toHaveProperty(['guardrails.maxCredits']);
  });

  test('400 for a min Fit score outside 40–90 and for 6 segments (contract)', async () => {
    const { app, seedPlan } = await setup(owner());
    const plan = await seedPlan();
    const s = plan.segments[0]!;
    for (const payload of [
      { guardrails: { maxCredits: 400, maxLeads: 100, minFitScore: 95 } },
      { segments: Array.from({ length: 6 }, () => ({ ...s, id: undefined })) },
      { segments: [] },
    ]) {
      const res = await app.inject({ method: 'PATCH', url: `/api/plans/${plan.id}`, payload });
      expect(res.statusCode).toBe(400);
    }
  });

  test('422 ADDRESS_NOT_FOUND for a place that cannot be geocoded', async () => {
    const { app, seedPlan } = await setup(owner());
    const plan = await seedPlan();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/plans/${plan.id}`,
      payload: { searchArea: { query: 'Atlantis' } },
    });
    expect(res.statusCode).toBe(422);
    expect(code(res.json())).toBe('ADDRESS_NOT_FOUND');
  });

  test("cross-Business: B can't read, edit or list A's Plan (404)", async () => {
    const { planning, seedPlan } = await setup();
    const plan = await seedPlan(owner());
    const app = await buildTestApp({ modules: [planning.module], actor: otherOwner() });
    expect((await app.inject({ method: 'GET', url: `/api/plans/${plan.id}` })).statusCode).toBe(
      404,
    );
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/plans/${plan.id}`,
      payload: { name: 'Mine now' },
    });
    expect(patch.statusCode).toBe(404);
    expect(code(patch.json())).toBe('NOT_FOUND');
    const list = listPlans.response.parse(
      (await app.inject({ method: 'GET', url: '/api/plans' })).json(),
    );
    expect(list.items).toEqual([]);
    expect(planning.store.all()[0]?.name).toBe('Bakeries near Austin');
  });

  test('404 for an unknown id, 400 for a malformed one', async () => {
    const { app } = await setup(owner());
    expect((await app.inject({ method: 'GET', url: `/api/plans/${UNKNOWN_ID}` })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ method: 'GET', url: '/api/plans/nope' })).statusCode).toBe(400);
  });
});

describe('GET /api/plans and /api/places/search', () => {
  test('lists Plans newest first with nextCursor', async () => {
    const { app, seedPlan } = await setup(owner());
    await seedPlan();
    await seedPlan();
    const res = await app.inject({ method: 'GET', url: '/api/plans?limit=1' });
    expect(res.statusCode).toBe(200);
    const body = listPlans.response.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).not.toHaveProperty('segments');
    expect(body.nextCursor).not.toBeNull();
  });

  test('searches places (≤ 5)', async () => {
    const { app } = await setup(owner());
    const res = await app.inject({ method: 'GET', url: '/api/places/search?q=Austin' });
    expect(res.statusCode).toBe(200);
    expect(searchPlaces.response.parse(res.json()).items).toEqual([
      { label: 'Austin, TX', lat: 30.2672, lng: -97.7431 },
    ]);
    expect((await app.inject({ method: 'GET', url: '/api/places/search?q=A' })).statusCode).toBe(
      400,
    );
  });
});
