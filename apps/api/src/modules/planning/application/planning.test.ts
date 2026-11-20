import { plan as planContract, planSummary } from '@app/contracts/planning';
import type { RunSummary } from '@app/contracts/research';
import { describe, expect, test } from 'vitest';
import type { PlanSnapshot } from '../domain/plan.js';
import { LlmUnavailableError } from '../../../shared/application/llm-client.js';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/domain/errors.js';
import {
  actingAs,
  BAKERIES_GOAL,
  bakeriesDraft,
  BUSINESS,
  CANE_SUGAR,
  draftReply,
  OTHER_BUSINESS,
  otherOwner,
  owner,
  planningFixture,
  POWDERED_SUGAR,
  sweetSupplyProfile,
  SWEET_SUPPLY_LOCATION,
  UNKNOWN_ID,
} from '../test/planning-fixture.js';

/** A stored segment as an edit body item (mutable arrays). */
function editable(s: PlanSnapshot['segments'][number]) {
  return { ...s, fitSignals: [...s.fitSignals], exclusions: [...s.exclusions] };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return (e as AppError).code;
  }
  throw new Error('expected an error');
}

async function fieldsOf(promise: Promise<unknown>): Promise<string[]> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    return Object.keys((e as ValidationError).details ?? {});
  }
  throw new Error('expected a ValidationError');
}

describe('FR-16: Create a Plan from a Goal', () => {
  test('AC: "bakeries within 3 miles that could buy our sugar" → Bakeries pitching the sugar, centre = profile point, radius 3', async () => {
    const f = planningFixture();
    const { plan, warnings } = await f.createBakeries();

    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]).toMatchObject({ name: 'Bakeries', productId: CANE_SUGAR });
    expect(plan.searchArea).toEqual({ ...SWEET_SUPPLY_LOCATION, radiusMiles: 3 });
    expect(plan.name).toBe('Bakeries near Austin');
    expect(plan.goal).toBe(BAKERIES_GOAL);
    expect(plan.businessId).toBe(BUSINESS);
    expect(plan.flowKey).toBe('local-buyers');
    expect(plan.icpEditedAt).toBeNull();
    expect(warnings).toEqual([]);
    expect(f.store.all()).toHaveLength(1);
  });

  test('asks the planning model with the goal and the profile Products, through the draft tool', async () => {
    const f = planningFixture();
    await f.createBakeries();
    const [request] = f.llm.requests;
    expect(request?.role).toBe('planning');
    expect(request?.purpose).toBe('planning.draft');
    expect(request?.tools?.map((t) => t.name)).toEqual(['draft_plan']);
    const prompt = request?.messages.map((m) => m.content).join('\n') ?? '';
    expect(prompt).toContain(BAKERIES_GOAL);
    expect(prompt).toContain(CANE_SUGAR);
    expect(prompt).toContain('Cane sugar, 50 lb bag');
  });

  test('fires plan_created with segments_count and radius_miles', async () => {
    const f = planningFixture();
    const { plan } = await f.createBakeries();
    expect(f.analytics.events).toEqual([
      {
        name: 'plan_created',
        actor: owner(),
        properties: {
          business_id: BUSINESS,
          plan_id: plan.id,
          segments_count: 1,
          radius_miles: 3,
        },
      },
    ]);
  });

  test('Guardrails default from the flow plan defaults', async () => {
    const f = planningFixture();
    const { plan } = await f.createBakeries();
    expect(plan.guardrails).toEqual({ maxCredits: 400, maxLeads: 100, minFitScore: 60 });
  });

  test('AC: a trial Business with 50 available gets max credits 50', async () => {
    const f = planningFixture();
    f.wallet.balances.set(BUSINESS, 50);
    const { plan } = await f.createBakeries();
    expect(plan.guardrails.maxCredits).toBe(50);
  });

  test('max credits is at least 10 when almost nothing is available', async () => {
    const f = planningFixture();
    f.wallet.balances.set(BUSINESS, 4);
    const { plan } = await f.createBakeries();
    expect(plan.guardrails.maxCredits).toBe(10);
  });

  test('radius parsed from the goal when the model gives none', async () => {
    const f = planningFixture();
    const { plan } = await f.createBakeries(owner(), { radiusMiles: null });
    expect(plan.searchArea.radiusMiles).toBe(3);
  });

  test('radius is the delivery radius when the goal states none', async () => {
    const f = planningFixture();
    f.llm.reply(draftReply(bakeriesDraft({ radiusMiles: null })));
    const { plan } = await f.app.createPlan.execute(owner(), 'bakeries that could buy our sugar');
    expect(plan.searchArea.radiusMiles).toBe(10);
  });

  test('radius is clamped to 1–25 miles', async () => {
    const f = planningFixture();
    expect((await f.createBakeries(owner(), { radiusMiles: 40 })).plan.searchArea.radiusMiles).toBe(
      25,
    );
    expect(
      (await f.createBakeries(owner(), { radiusMiles: 0.2 })).plan.searchArea.radiusMiles,
    ).toBe(1);
  });

  test('a place the goal names becomes the centre', async () => {
    const f = planningFixture();
    const { plan, warnings } = await f.createBakeries(owner(), { place: 'Fredericksburg, TX' });
    expect(plan.searchArea).toEqual({
      label: 'Fredericksburg, TX',
      lat: 30.2752,
      lng: -98.872,
      radiusMiles: 3,
    });
    expect(warnings).toEqual([]);
  });

  test("a place that can't be geocoded → profile location and a warning", async () => {
    const f = planningFixture();
    const { plan, warnings } = await f.createBakeries(owner(), { place: 'Atlantis' });
    expect(plan.searchArea).toEqual({ ...SWEET_SUPPLY_LOCATION, radiusMiles: 3 });
    expect(warnings).toEqual(["We couldn't find 'Atlantis', so we used your address."]);
  });

  test('a Product the model invents is replaced by the first profile Product', async () => {
    const f = planningFixture();
    const draft = bakeriesDraft();
    const { plan } = await f.createBakeries(owner(), {
      segments: [
        { ...draft.segments[0]!, productId: UNKNOWN_ID },
        {
          name: 'Dessert shops',
          fitSignals: ['Makes desserts'],
          exclusions: [],
          productId: POWDERED_SUGAR,
        },
      ],
    });
    expect(plan.segments.map((s) => s.productId)).toEqual([CANE_SUGAR, POWDERED_SUGAR]);
  });

  test.each([
    ['no profile', null],
    ['an incomplete profile', sweetSupplyProfile({ complete: false })],
    ['no location', sweetSupplyProfile({ location: null })],
    ['no Products', sweetSupplyProfile({ products: [] })],
  ])('422 PROFILE_INCOMPLETE with %s, without calling the model', async (_, profile) => {
    const f = planningFixture();
    if (profile) f.profiles.profiles.set(BUSINESS, profile);
    else f.profiles.profiles.delete(BUSINESS);
    expect(await codeOf(f.app.createPlan.execute(owner(), BAKERIES_GOAL))).toBe(
      'PROFILE_INCOMPLETE',
    );
    expect(f.llm.requests).toHaveLength(0);
    expect(f.store.all()).toHaveLength(0);
  });

  test.each([
    ['the model is unavailable', new LlmUnavailableError('timeout')],
    [
      'the model calls no tool',
      { text: 'hi', usage: { inputTokens: 1, outputTokens: 1 }, model: 'x' },
    ],
    [
      'the tool input is invalid',
      {
        ...draftReply(bakeriesDraft()),
        toolCall: { name: 'draft_plan', input: { segments: 'no' } },
      },
    ],
    [
      'no segment is usable',
      draftReply(
        bakeriesDraft({
          segments: [{ name: 'X', fitSignals: [], exclusions: [], productId: CANE_SUGAR }],
        }),
      ),
    ],
  ])('503 ASSISTANT_UNAVAILABLE when %s; nothing is stored', async (_, reply) => {
    const f = planningFixture();
    f.llm.reply(reply);
    expect(await codeOf(f.app.createPlan.execute(owner(), BAKERIES_GOAL))).toBe(
      'ASSISTANT_UNAVAILABLE',
    );
    expect(f.store.all()).toHaveLength(0);
    expect(f.analytics.events).toHaveLength(0);
  });

  test('403 EMAIL_NOT_VERIFIED before the email is verified; the model is not called', async () => {
    const f = planningFixture();
    f.llm.reply(draftReply(bakeriesDraft()));
    expect(
      await codeOf(f.app.createPlan.execute(owner({ emailVerified: false }), BAKERIES_GOAL)),
    ).toBe('EMAIL_NOT_VERIFIED');
    expect(f.llm.requests).toHaveLength(0);
    expect(f.store.all()).toHaveLength(0);
  });

  test('at most 30 Plans per Business per day (429 TOO_MANY_REQUESTS); a new UTC day resets it', async () => {
    const f = planningFixture();
    for (let i = 0; i < 30; i += 1) {
      f.tick();
      await f.createBakeries();
    }
    f.llm.reply(draftReply(bakeriesDraft()));
    const error = await f.app.createPlan.execute(owner(), BAKERIES_GOAL).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'TOO_MANY_REQUESTS', details: { limit: 30 } });
    expect(f.llm.requests).toHaveLength(30);
    // Another Business has its own allowance.
    expect((await f.createBakeries(otherOwner())).plan.businessId).toBe(OTHER_BUSINESS);
    f.clock.set(new Date('2026-11-20T00:00:01.000Z'));
    expect((await f.app.createPlan.execute(owner(), BAKERIES_GOAL)).plan.businessId).toBe(BUSINESS);
  });

  test('the daily Plan cap is configurable', async () => {
    const f = planningFixture({ dailyPlanLimit: 1 });
    await f.createBakeries();
    f.llm.reply(draftReply(bakeriesDraft()));
    expect(await codeOf(f.app.createPlan.execute(owner(), BAKERIES_GOAL))).toBe(
      'TOO_MANY_REQUESTS',
    );
  });

  test('Staff Acting as create the Plan in the target Business', async () => {
    const f = planningFixture();
    const { plan } = await f.createBakeries(actingAs());
    expect(plan.businessId).toBe(BUSINESS);
  });

  test('403 without the owner role', async () => {
    const f = planningFixture();
    await expect(
      f.app.createPlan.execute(owner({ roles: ['member'] }), BAKERIES_GOAL),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('FR-17: Edit a Plan', () => {
  test('renames', async () => {
    const f = planningFixture();
    const { plan } = await f.createBakeries();
    f.tick();
    const updated = await f.app.updatePlan.execute(owner(), plan.id, {
      name: 'East side bakeries',
    });
    expect(updated.name).toBe('East side bakeries');
    expect(updated.updatedAt).toEqual(f.clock.now());
    expect(updated.icpEditedAt).toBeNull();
  });

  test('AC: changing a Fit signal sets icp_edited_at, which stays set on later edits; plan_icp_edited fires once', async () => {
    const f = planningFixture();
    const { plan } = await f.createBakeries();
    const segment = plan.segments[0]!;
    f.tick();
    const firstAt = f.clock.now();
    const first = await f.app.updatePlan.execute(owner(), plan.id, {
      segments: [
        { ...editable(segment), fitSignals: ['Bakes on site', 'Has a wholesale counter'] },
      ],
    });
    expect(first.icpEditedAt).toEqual(firstAt);

    f.tick();
    const second = await f.app.updatePlan.execute(owner(), plan.id, {
      segments: [{ ...editable(first.segments[0]!), exclusions: [] }],
    });
    expect(second.icpEditedAt).toEqual(firstAt);
    expect((await f.store.findById(BUSINESS, plan.id))?.icpEditedAt).toEqual(firstAt);

    const icpEvents = f.analytics.events.filter((e) => e.name === 'plan_icp_edited');
    expect(icpEvents).toEqual([
      {
        name: 'plan_icp_edited',
        actor: owner(),
        properties: { business_id: BUSINESS, plan_id: plan.id, field: 'fit_signals' },
      },
    ]);
  });

  test('adds, removes and re-pitches segments', async () => {
    const f = planningFixture();
    const { plan } = await f.createBakeries();
    const updated = await f.app.updatePlan.execute(owner(), plan.id, {
      segments: [
        {
          name: 'Dessert shops',
          fitSignals: ['Makes desserts'],
          exclusions: [],
          productId: POWDERED_SUGAR,
        },
      ],
    });
    expect(updated.segments).toHaveLength(1);
    expect(updated.segments[0]).toMatchObject({ name: 'Dessert shops', productId: POWDERED_SUGAR });
    expect(updated.segments[0]?.id).not.toBe(plan.segments[0]?.id);
    expect(f.analytics.events.at(-1)?.properties).toMatchObject({ field: 'segments' });
  });

  test('a Product not in the profile is rejected naming the segment field', async () => {
    const f = planningFixture();
    const { plan } = await f.createBakeries();
    expect(
      await fieldsOf(
        f.app.updatePlan.execute(owner(), plan.id, {
          segments: [{ ...editable(plan.segments[0]!), productId: UNKNOWN_ID }],
        }),
      ),
    ).toEqual(['segments.0.productId']);
  });

  test('AC: a radius of 30 is rejected naming searchArea.radiusMiles', async () => {
    const f = planningFixture();
    const { plan } = await f.createBakeries();
    expect(
      await fieldsOf(
        f.app.updatePlan.execute(owner(), plan.id, { searchArea: { radiusMiles: 30 } }),
      ),
    ).toEqual(['searchArea.radiusMiles']);
  });

  test('changes the radius, keeping the centre', async () => {
    const f = planningFixture();
    const { plan } = await f.createBakeries();
    const updated = await f.app.updatePlan.execute(owner(), plan.id, {
      searchArea: { radiusMiles: 12.5 },
    });
    expect(updated.searchArea).toEqual({ ...SWEET_SUPPLY_LOCATION, radiusMiles: 12.5 });
  });

  test('a place query is geocoded; an unknown place is 422 ADDRESS_NOT_FOUND', async () => {
    const f = planningFixture();
    const { plan } = await f.createBakeries();
    const moved = await f.app.updatePlan.execute(owner(), plan.id, {
      searchArea: { query: 'Fredericksburg', radiusMiles: 5 },
    });
    expect(moved.searchArea).toEqual({
      label: 'Fredericksburg, TX',
      lat: 30.2752,
      lng: -98.872,
      radiusMiles: 5,
    });
    expect(
      await codeOf(
        f.app.updatePlan.execute(owner(), plan.id, { searchArea: { query: 'Atlantis' } }),
      ),
    ).toBe('ADDRESS_NOT_FOUND');
  });

  test('a picked point moves the centre', async () => {
    const f = planningFixture();
    const { plan } = await f.createBakeries();
    const moved = await f.app.updatePlan.execute(owner(), plan.id, {
      searchArea: { label: 'Austin, TX', lat: 30.2672, lng: -97.7431 },
    });
    expect(moved.searchArea).toEqual({
      label: 'Austin, TX',
      lat: 30.2672,
      lng: -97.7431,
      radiusMiles: 3,
    });
  });

  test('Guardrails are checked against the flow limits', async () => {
    const f = planningFixture();
    const { plan } = await f.createBakeries();
    const ok = await f.app.updatePlan.execute(owner(), plan.id, {
      guardrails: { maxCredits: 1000, maxLeads: 500, minFitScore: 75 },
    });
    expect(ok.guardrails).toEqual({ maxCredits: 1000, maxLeads: 500, minFitScore: 75 });
    expect(
      await fieldsOf(
        f.app.updatePlan.execute(owner(), plan.id, {
          guardrails: { maxCredits: 1001, maxLeads: 100, minFitScore: 60 },
        }),
      ),
    ).toEqual(['guardrails.maxCredits']);
    expect(
      await fieldsOf(
        f.app.updatePlan.execute(owner(), plan.id, {
          guardrails: { maxCredits: 400, maxLeads: 501, minFitScore: 60 },
        }),
      ),
    ).toEqual(['guardrails.maxLeads']);
  });

  test('a rejected edit saves nothing', async () => {
    const f = planningFixture();
    const { plan } = await f.createBakeries();
    await expect(
      f.app.updatePlan.execute(owner(), plan.id, {
        name: 'New name',
        searchArea: { radiusMiles: 30 },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await f.store.findById(BUSINESS, plan.id))?.name).toBe('Bakeries near Austin');
  });

  test("404 for another Business's Plan and for an unknown id", async () => {
    const f = planningFixture();
    const { plan } = await f.createBakeries();
    await expect(
      f.app.updatePlan.execute(otherOwner(), plan.id, { name: 'Mine now' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      f.app.updatePlan.execute(owner(), UNKNOWN_ID, { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await f.store.findById(BUSINESS, plan.id))?.name).toBe('Bakeries near Austin');
  });
});

const run = (planId: string): RunSummary => ({
  id: '00000000-0000-7000-8000-00000000e001',
  planId,
  flow: { key: 'local-buyers', version: 1 },
  attempt: { current: 1, max: 3 },
  takingLonger: false,
  status: 'completed',
  steps: [],
  startedAt: '2026-11-19T10:00:00.000Z',
  finishedAt: '2026-11-19T10:30:00.000Z',
  creditsReserved: 400,
  creditsSpent: 137,
  leadsDelivered: 25,
  costPerLead: 5.48,
  budgetReached: false,
  timeReached: false,
  failureReason: null,
});

describe('FR-17: the estimate and the Plan view', () => {
  test('usually 60% of max credits when the flow has too few runs', async () => {
    const f = planningFixture();
    const { plan } = await f.createBakeries();
    const view = planContract.parse(await f.app.queries.getPlan(owner(), plan.id));
    expect(view.estimate).toEqual({ maxCredits: 400, typicalCredits: 240 });
    expect(f.runStats.asked).toEqual(['local-buyers']);
  });

  test('usually the median of comparable runs when there are enough', async () => {
    const f = planningFixture();
    f.runStats.typical = 137;
    const { plan } = await f.createBakeries();
    const view = await f.app.queries.getPlan(owner(), plan.id);
    expect(view.estimate).toEqual({ maxCredits: 400, typicalCredits: 137 });
  });

  test('shows the available balance, last run, Lead count and warnings', async () => {
    const f = planningFixture();
    const { plan, warnings } = await f.createBakeries(owner(), { place: 'Atlantis' });
    f.activity.runs.set(plan.id, run(plan.id));
    f.activity.leads.set(plan.id, 25);
    const view = planContract.parse(await f.app.queries.getPlan(owner(), plan.id, warnings));
    expect(view.available).toBe(863);
    expect(view.lastRun?.creditsSpent).toBe(137);
    expect(view.leadsCount).toBe(25);
    expect(view.warnings).toEqual(["We couldn't find 'Atlantis', so we used your address."]);
    expect(view.icpEdited).toBe(false);
    expect(view.createdAt).toBe('2026-11-19T10:00:00.000Z');
  });

  test('a trial Business sees 50 available and an estimate within 50', async () => {
    const f = planningFixture();
    f.wallet.balances.set(BUSINESS, 50);
    const { plan } = await f.createBakeries();
    const view = await f.app.queries.getPlan(owner(), plan.id);
    expect(view.available).toBe(50);
    expect(view.estimate).toEqual({ maxCredits: 50, typicalCredits: 30 });
  });

  test("404 for another Business's Plan", async () => {
    const f = planningFixture();
    const { plan } = await f.createBakeries();
    await expect(f.app.queries.getPlan(otherOwner(), plan.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('Plans list, snapshot for research, Product usage', () => {
  test('lists the Business’s Plans newest first, paginated, without segments', async () => {
    const f = planningFixture();
    const created: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      f.tick();
      created.push((await f.createBakeries()).plan.id);
    }
    await f.createBakeries(otherOwner());

    const first = await f.app.queries.listPlans(owner(), { limit: 2 });
    expect(first.items.map((p) => p.id)).toEqual([created[2], created[1]]);
    expect(first.nextCursor).not.toBeNull();
    first.items.forEach((p) => planSummary.strict().parse(p));

    const second = await f.app.queries.listPlans(owner(), { cursor: first.nextCursor!, limit: 2 });
    expect(second.items.map((p) => p.id)).toEqual([created[0]]);
    expect(second.nextCursor).toBeNull();
  });

  test('an invalid cursor is a ValidationError', async () => {
    const f = planningFixture();
    await expect(
      f.app.queries.listPlans(owner(), { cursor: 'nope', limit: 2 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('getPlanSnapshot is scoped to the Business', async () => {
    const f = planningFixture();
    const { plan } = await f.createBakeries();
    const snapshot = await f.app.queries.getPlanSnapshot(BUSINESS, plan.id);
    expect(snapshot).toMatchObject({
      id: plan.id,
      flowKey: 'local-buyers',
      guardrails: { maxCredits: 400, maxLeads: 100, minFitScore: 60 },
      searchArea: { radiusMiles: 3 },
      icpEdited: false,
    });
    expect(snapshot?.segments[0]?.productId).toBe(CANE_SUGAR);
    expect(await f.app.queries.getPlanSnapshot(OTHER_BUSINESS, plan.id)).toBeNull();
  });

  test('productInUse answers for the Business only', async () => {
    const f = planningFixture();
    await f.createBakeries();
    expect(await f.app.queries.productInUse(BUSINESS, CANE_SUGAR)).toBe(true);
    expect(await f.app.queries.productInUse(BUSINESS, POWDERED_SUGAR)).toBe(false);
    expect(await f.app.queries.productInUse(OTHER_BUSINESS, CANE_SUGAR)).toBe(false);
  });

  test('searchPlaces returns geocoded places', async () => {
    const f = planningFixture();
    expect(await f.app.queries.searchPlaces(owner(), 'Austin')).toEqual({
      items: [{ label: 'Austin, TX', lat: 30.2672, lng: -97.7431 }],
    });
    expect(await f.app.queries.searchPlaces(owner(), 'Atlantis')).toEqual({ items: [] });
  });
});
