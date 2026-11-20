import { describe, expect, test } from 'vitest';
import { createInMemoryLeads } from './modules/leads/index.js';
import { RunExecutor } from './modules/research/application/run-executor.js';
import { owner, PLAN, researchFixture } from './modules/research/test/research-fixture.js';
import { researchProspectStore } from './research-prospects.js';
import { RecordingAnalyticsTracker } from './shared/infrastructure/analytics/db-analytics-tracker.js';
import { FixedClock } from './shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from './shared/infrastructure/time/uuid7.js';

const RUN = '00000000-0000-7000-8000-0000000a0001';
const BUSINESS = '00000000-0000-7000-8000-00000000b001';
const PRODUCT = '00000000-0000-7000-8000-00000000f001';
const MAPS = {
  name: 'Google Maps',
  url: 'https://maps.example/1',
  retrievedAt: '2026-11-19T10:00:00.000Z',
};
const SITE = {
  name: 'Website',
  url: 'https://rise.example',
  retrievedAt: '2026-11-19T10:05:00.000Z',
};
const ZB = { name: 'ZeroBounce', url: null, retrievedAt: '2026-11-19T10:06:00.000Z' };

function leadsFixture() {
  return createInMemoryLeads({
    clock: new FixedClock(new Date('2026-11-19T10:00:00.000Z')),
    ids: new SequentialIdGenerator(),
    analytics: new RecordingAnalyticsTracker(),
    plans: {
      findPlan: (_b, p) =>
        Promise.resolve({ id: p, name: 'Bakeries', centre: { lat: 30.26, lng: -97.74 } }),
    },
  });
}

const place = (n: number, extra: Partial<Record<string, unknown>> = {}) => ({
  placeKeys: [`google:${n}`],
  name: `Bakery ${n}`,
  address: `${n} Main St, Austin`,
  lat: 30.26 + n / 1000,
  lng: -97.74,
  category: 'Bakery',
  phone: null,
  website: null,
  rating: 4.5,
  reviewsCount: 100 + n,
  segmentId: 'seg-1',
  source: MAPS,
  ...extra,
});

describe('composition: research Prospects on the leads module', () => {
  test('addProspects returns added and total, merging duplicates', async () => {
    const leads = leadsFixture();
    const store = researchProspectStore(leads.prospectStore);
    await expect(store.addProspects(RUN, BUSINESS, [place(1), place(2)])).resolves.toEqual({
      added: 2,
      total: 2,
    });
    await expect(
      store.addProspects(RUN, BUSINESS, [place(2), place(3), place(3)]),
    ).resolves.toEqual({ added: 1, total: 3 });
    const listed = await store.listProspects(RUN);
    const one = listed.find((p) => p.name === 'Bakery 1');
    expect(one).toMatchObject({
      segmentId: 'seg-1',
      rating: 4.5,
      reviewsCount: 101,
      excluded: null,
      placeKeys: ['google:1'],
      sources: [MAPS],
    });
  });

  test('updates map contacts, verification, appended Evidence, Sources, summary and Pitch', async () => {
    const leads = leadsFixture();
    const store = researchProspectStore(leads.prospectStore, {
      products: { names: () => Promise.resolve(new Map([[PRODUCT, 'Cane sugar']])) },
    });
    await store.addProspects(RUN, BUSINESS, [place(1)]);
    const [p] = await store.listProspects(RUN);
    if (!p) throw new Error('no prospect');

    await store.updateProspect(p.id, {
      addContacts: [
        { type: 'email', value: 'Hi@Rise.example', verification: 'unverified', source: SITE },
      ],
      addSources: [SITE],
      summary: 'Artisan bakery',
      addEvidence: [{ fact: 'Artisan bakery', points: 0, source: SITE }],
      ownerNames: ['Ana'],
    });
    await store.updateProspect(p.id, {
      verifyContacts: [
        { type: 'email', value: 'hi@rise.example', verification: 'verified', source: ZB },
      ],
    });
    await store.updateProspect(p.id, {
      fitScore: 82,
      addEvidence: [
        { fact: 'Artisan bakery', points: 0, source: SITE },
        { fact: 'Bakes daily', points: 20, source: SITE },
      ],
      pitch: { productId: PRODUCT, productName: null, reason: 'They bake daily' },
    });
    await store.updateProspect(p.id, { excluded: 'already_delivered' });

    const [after] = await store.listProspects(RUN);
    expect(after).toMatchObject({
      fitScore: 82,
      summary: 'Artisan bakery',
      excluded: 'already_delivered',
      sources: [MAPS, SITE],
      pitch: { productId: PRODUCT, productName: 'Cane sugar', reason: 'They bake daily' },
    });
    expect(after?.evidence.map((e) => e.fact)).toEqual(['Artisan bakery', 'Bakes daily']);
    expect(after?.contacts).toContainEqual(
      expect.objectContaining({
        type: 'email',
        value: 'hi@rise.example',
        verification: 'verified',
        source: ZB,
      }),
    );
  });

  test('FR-19: a full run through the adapter delivers Leads once (in memory)', async () => {
    const f = await researchFixture();
    const leads = leadsFixture();
    const executor = new RunExecutor({
      store: f.store,
      tools: f.tools,
      catalog: f.tools,
      prospects: researchProspectStore(leads.prospectStore),
      billing: f.billing.billingCommands,
      clock: f.clock,
      ids: f.ids,
      sleeper: f.sleeper,
      analytics: f.analytics,
      queue: f.queue,
      workerId: 'adapter',
    });
    const started = await f.runs.start(owner(), PLAN);
    expect(await f.runToEnd(started.id, executor)).toEqual(['completed']);
    const run = f.store.run(started.id)?.toSnapshot();
    expect(run?.leadsDelivered).toBeGreaterThan(0);
    const counts = await leads.leadsQueries.leadsCounts(BUSINESS, [PLAN]);
    expect(counts.get(PLAN)).toBe(run?.leadsDelivered);

    const second = await f.runs.start(owner(), PLAN);
    expect(await f.runToEnd(second.id, executor)).toEqual(['completed']);
    // Places delivered by the first run are never delivered again: only new places are added.
    const first = run?.leadsDelivered ?? 0;
    const again = f.store.run(second.id)?.toSnapshot().leadsDelivered ?? 0;
    expect(again).toBeLessThan(first);
    const after = await leads.leadsQueries.leadsCounts(BUSINESS, [PLAN]);
    expect(after.get(PLAN)).toBe(first + again);
  });
});
