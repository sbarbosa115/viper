import { plan as planContract } from '@app/contracts/planning';
import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { FixtureGeocoder } from '../../../shared/infrastructure/geo/fixture-geocoder.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { ValidationError } from '../../../shared/domain/errors.js';
import { Guardrails } from '../domain/guardrails.js';
import { Plan } from '../domain/plan.js';
import { SearchArea } from '../domain/search-area.js';
import { createPlanning, seed } from '../index.js';
import {
  BAKERIES_GOAL,
  bakeriesDraft,
  BUSINESS,
  CANE_SUGAR,
  draftReply,
  FakeProfiles,
  FakeWallet,
  OTHER_BUSINESS,
  owner,
  POWDERED_SUGAR,
  ScriptedLlm,
  SWEET_SUPPLY_LOCATION,
} from '../test/planning-fixture.js';
import { KyselyPlanRepository } from './kysely-plans.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const clock = new FixedClock(new Date('2026-11-19T10:00:00.000Z'));
const ids = new Uuid7Generator();
const repo = new KyselyPlanRepository(db);
const products = new Set([CANE_SUGAR, POWDERED_SUGAR]);

function newPlan(businessId = BUSINESS, segments = 2): Plan {
  return Plan.create({
    id: ids.next(),
    businessId,
    flowKey: 'local-buyers',
    name: 'Bakeries near Austin',
    goal: BAKERIES_GOAL,
    segments: Array.from({ length: segments }, (_, i) => ({
      id: ids.next(),
      name: `Segment ${i}`,
      fitSignals: ['Bakes on site', 'Café'],
      exclusions: i === 0 ? ['Chains'] : [],
      productId: i === 0 ? CANE_SUGAR : POWDERED_SUGAR,
    })),
    searchArea: SearchArea.of({ ...SWEET_SUPPLY_LOCATION, radiusMiles: 3.5 }),
    guardrails: Guardrails.of(
      { maxCredits: 400, maxLeads: 100, minFitScore: 60 },
      {
        maxCredits: 1000,
        maxLeads: 500,
      },
    ),
    productIds: products,
    now: clock.now(),
  });
}

beforeEach(async () => {
  await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
  for (const table of ['target_segments', 'plans']) {
    await sql.raw(`TRUNCATE TABLE ${table}`).execute(db);
  }
  await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);
});

afterAll(async () => {
  await db.destroy();
});

describe('KyselyPlanRepository', () => {
  test('round-trips a Plan with its segments in order', async () => {
    const plan = newPlan();
    await repo.save(plan);
    const loaded = await repo.findById(BUSINESS, plan.id);
    expect(loaded?.toSnapshot()).toEqual(plan.toSnapshot());
  });

  test('saving again updates fields and replaces segments; icpEditedAt persists', async () => {
    const plan = newPlan();
    await repo.save(plan);
    const later = new Date('2026-11-19T11:00:00.000Z');
    plan.rename('East side', later);
    plan.replaceSegments([{ ...plan.segments[1]!.toSnapshot(), fitSignals: ['Dessert case'] }], {
      productIds: products,
      newId: () => ids.next(),
      now: later,
    });
    plan.changeSearchArea(plan.searchArea.withRadius(25), later);
    await repo.save(plan);
    const loaded = (await repo.findById(BUSINESS, plan.id))?.toSnapshot();
    expect(loaded).toEqual(plan.toSnapshot());
    expect(loaded?.icpEditedAt).toEqual(later);
    expect(loaded?.createdAt).toEqual(clock.now());
    const rows = await db.selectFrom('target_segments').selectAll().execute();
    expect(rows).toHaveLength(1);
  });

  test("another Business's Plan is not found", async () => {
    const plan = newPlan();
    await repo.save(plan);
    expect(await repo.findById(OTHER_BUSINESS, plan.id)).toBeNull();
  });

  test('lists newest first with a stable cursor across equal times, scoped to the Business', async () => {
    const saved: Plan[] = [];
    for (let i = 0; i < 3; i += 1) {
      const p = newPlan(BUSINESS, 1);
      saved.push(p);
      await repo.save(p);
    }
    await repo.save(newPlan(OTHER_BUSINESS, 1));
    const expected = saved
      .map((p) => p.id)
      .sort()
      .reverse();

    const first = await repo.list(BUSINESS, { limit: 2 });
    expect(first.map((p) => p.id)).toEqual(expected.slice(0, 2));
    expect(first[0]?.segments).toHaveLength(1);
    const last = first.at(-1)!;
    const second = await repo.list(BUSINESS, {
      after: { createdAt: last.createdAt, id: last.id },
      limit: 2,
    });
    expect(second.map((p) => p.id)).toEqual(expected.slice(2));
  });

  test('productInUse is scoped to the Business', async () => {
    await repo.save(newPlan(BUSINESS, 1));
    expect(await repo.productInUse(BUSINESS, CANE_SUGAR)).toBe(true);
    expect(await repo.productInUse(BUSINESS, POWDERED_SUGAR)).toBe(false);
    expect(await repo.productInUse(OTHER_BUSINESS, CANE_SUGAR)).toBe(false);
  });
});

describe('createPlanning on MySQL', () => {
  function build() {
    const llm = new ScriptedLlm();
    const analytics = new RecordingAnalyticsTracker();
    const planning = createPlanning({
      db,
      clock,
      ids,
      analytics,
      llm,
      geocoder: new FixtureGeocoder(),
      profiles: new FakeProfiles(),
      wallet: new FakeWallet(),
    });
    return { planning, llm, analytics };
  }

  test('FR-16 + FR-17: create, edit and read a Plan', async () => {
    const { planning, llm } = build();
    llm.reply(draftReply(bakeriesDraft()));
    const { planId } = await planning.planningCommands.draftFromGoal(owner(), BAKERIES_GOAL);

    const app = planning.application;
    const updated = await app.updatePlan.execute(owner(), planId, {
      segments: [
        { name: 'Bakeries', fitSignals: ['Bakes on site'], exclusions: [], productId: CANE_SUGAR },
      ],
      guardrails: { maxCredits: 300, maxLeads: 50, minFitScore: 70 },
    });
    expect(updated.icpEditedAt).toEqual(clock.now());

    const view = planContract.parse(await planning.planningQueries.getPlan(owner(), planId));
    expect(view.searchArea).toEqual({ ...SWEET_SUPPLY_LOCATION, radiusMiles: 3 });
    expect(view.guardrails).toEqual({ maxCredits: 300, maxLeads: 50, minFitScore: 70 });
    expect(view.estimate).toEqual({ maxCredits: 300, typicalCredits: 180 });
    expect(view.icpEdited).toBe(true);

    expect(await planning.planningQueries.getPlanSnapshot(BUSINESS, planId)).toMatchObject({
      id: planId,
      icpEdited: true,
    });
    expect(await planning.planningQueries.productInUse(BUSINESS, CANE_SUGAR)).toBe(true);
  });

  test('a rejected edit rolls back the whole transaction', async () => {
    const { planning, llm } = build();
    llm.reply(draftReply(bakeriesDraft()));
    const { planId } = await planning.planningCommands.draftFromGoal(owner(), BAKERIES_GOAL);
    await expect(
      planning.application.updatePlan.execute(owner(), planId, {
        name: 'Renamed',
        guardrails: { maxCredits: 2000, maxLeads: 100, minFitScore: 60 },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await repo.findById(BUSINESS, planId))?.name).toBe('Bakeries near Austin');
  });
});

describe('seed (PRD section 8a)', () => {
  const demo = {
    businesses: {
      sweetSupply: '00000000-0000-7000-8000-00000000d001',
      cornerCoffee: '00000000-0000-7000-8000-00000000d003',
    },
    products: {
      caneSugar: '00000000-0000-7000-8000-00000000d201',
      espressoBeans: '00000000-0000-7000-8000-00000000d203',
    },
    plans: {
      bakeriesNearAustin: '00000000-0000-7000-8000-00000000d301',
      cornerCafes: '00000000-0000-7000-8000-00000000d302',
    },
  };

  test('creates "Bakeries near Austin" and the Corner Coffee Plan, idempotently', async () => {
    await seed({ db, clock, ids, demo });
    await seed({ db, clock, ids, demo });

    const bakeries = (
      await repo.findById(demo.businesses.sweetSupply, demo.plans.bakeriesNearAustin)
    )?.toSnapshot();
    expect(bakeries?.name).toBe('Bakeries near Austin');
    expect(bakeries?.segments.map((s) => s.name)).toEqual([
      'Bakeries',
      'Cafés that bake',
      'Dessert shops',
    ]);
    expect(bakeries?.segments.every((s) => s.productId === demo.products.caneSugar)).toBe(true);
    expect(
      bakeries?.segments.every((s) => s.fitSignals.length > 0 && s.exclusions.length > 0),
    ).toBe(true);
    expect(bakeries?.searchArea).toEqual({ ...SWEET_SUPPLY_LOCATION, radiusMiles: 3 });
    expect(bakeries?.guardrails.maxCredits).toBe(400);

    const corner = await repo.findById(demo.businesses.cornerCoffee, demo.plans.cornerCafes);
    expect(corner?.guardrails.maxCredits).toBe(400);
    expect(await db.selectFrom('plans').select('id').execute()).toHaveLength(2);
    expect(await db.selectFrom('target_segments').select('id').execute()).toHaveLength(5);
  });
});
