import { lead as leadContract, leadCsvColumns, leadSummary } from '@app/contracts/leads';
import { describe, expect, test } from 'vitest';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import type { LeadsUnitOfWork } from '../application/ports.js';
import {
  actingAs,
  bakery,
  BUSINESS,
  deliverCommand,
  MAPS,
  otherOwner,
  OTHER_BUSINESS,
  OTHER_PLAN,
  OTHER_RUN,
  owner,
  PLAN,
  RUN_1,
  RUN_2,
  scoredProspect,
  setup,
  TWILIO,
  UNKNOWN_ID,
  verifiedEmail,
  ZEROBOUNCE,
} from './leads-fixture.js';

/**
 * The leads module's behaviour through its use cases, run against any storage: the in-memory
 * fake (application tests) and MySQL (integration tests), so the fake stays honest.
 */
export function describeLeadsBehaviour(
  storage: string,
  makeUow: () => LeadsUnitOfWork | Promise<LeadsUnitOfWork>,
): void {
  const fresh = async () => setup(await makeUow());

  /** Delivers `scores` as Leads of RUN_1 (in this order) and returns their Lead ids by score. */
  async function delivered(scores: number[], options: { runId?: string } = {}) {
    const s = await fresh();
    for (const fitScore of scores) {
      await scoredProspect(s.app.prospects, { fitScore, runId: options.runId ?? RUN_1 });
    }
    await s.app.prospects.deliver(deliverCommand({ runId: options.runId ?? RUN_1 }));
    return s;
  }

  describe(`[${storage}] FR-19 Step 3: addProspects merges within the run`, () => {
    test('duplicates by place id, phone, domain and name + 50 m share one Prospect', async () => {
      const { app } = await fresh();
      const ids = await app.prospects.addProspects(RUN_1, BUSINESS, [
        bakery({
          name: 'Sweet Crumbs Bakery',
          placeKeys: ['google:A'],
          phone: '512-555-0101',
          lat: 30.27,
          lng: -97.74,
        }),
        bakery({
          name: 'Sweet Crumbs',
          placeKeys: ['osm:node/1'],
          phone: '(512) 555-0101',
          website: null,
        }),
        bakery({
          name: 'Flour & Fig',
          placeKeys: ['google:B'],
          phone: null,
          website: 'https://flourfig.example',
        }),
        bakery({
          name: 'Flour and Fig Bakery',
          placeKeys: ['apify:x'],
          phone: null,
          website: 'www.flourfig.example/menu',
        }),
        bakery({
          name: 'Little Loaf',
          placeKeys: ['google:C'],
          phone: null,
          lat: 30.25,
          lng: -97.75,
        }),
        bakery({
          name: 'LITTLE LOAF',
          placeKeys: ['osm:node/2'],
          phone: null,
          lat: 30.2502,
          lng: -97.75,
        }),
        bakery({
          name: 'Little Loaf',
          placeKeys: ['osm:node/3'],
          phone: null,
          lat: 30.26,
          lng: -97.75,
        }),
      ]);
      expect(ids[1]).toBe(ids[0]);
      expect(ids[3]).toBe(ids[2]);
      expect(ids[5]).toBe(ids[4]);
      expect(ids[6]).not.toBe(ids[4]);
      expect(new Set(ids).size).toBe(4);
      const later = await app.prospects.addProspects(RUN_1, BUSINESS, [
        bakery({ name: 'Sweet Crumbs Bakery', placeKeys: ['google:A'], phone: null }),
      ]);
      expect(later).toEqual([ids[0]]);
      const list = await app.prospects.listProspects(RUN_1);
      expect(list).toHaveLength(4);
      const sweet = list.find((p) => p.id === ids[0]);
      expect(sweet?.placeKeys).toEqual(
        expect.arrayContaining(['google:A', 'osm:node/1', 'phone:+15125550101']),
      );
    });

    test('a run of another Business is refused', async () => {
      const { app } = await fresh();
      await app.prospects.addProspects(RUN_1, BUSINESS, [bakery()]);
      await expect(app.prospects.addProspects(RUN_1, OTHER_BUSINESS, [bakery()])).rejects.toThrow(
        ValidationError,
      );
    });

    test('listProspects filters by stage and orders by pre-score', async () => {
      const { app } = await fresh();
      const [a, b, c] = await app.prospects.addProspects(RUN_1, BUSINESS, [
        bakery(),
        bakery(),
        bakery(),
      ]);
      if (!a || !b || !c) throw new Error('ids');
      await app.prospects.updateProspect(a, { preScore: 40 });
      await app.prospects.updateProspect(b, { preScore: 90 });
      expect((await app.prospects.listProspects(RUN_1)).map((p) => p.id)).toEqual([b, a, c]);
      expect((await app.prospects.listProspects(RUN_1, { stage: 'new' })).map((p) => p.id)).toEqual(
        [c],
      );
      expect(
        (await app.prospects.listProspects(RUN_1, { stage: 'pre_scored', limit: 1 })).map(
          (p) => p.id,
        ),
      ).toEqual([b]);
      expect(await app.prospects.listProspects(OTHER_RUN)).toEqual([]);
    });
  });

  describe(`[${storage}] FR-19: updateProspect`, () => {
    test('stores website data, Contacts with Sources, Evidence, scores and the Pitch', async () => {
      const { app } = await fresh();
      const [id] = await app.prospects.addProspects(RUN_1, BUSINESS, [bakery({ website: null })]);
      if (!id) throw new Error('id');
      const updated = await app.prospects.updateProspect(id, {
        website: { url: 'https://crumbs.example', summary: 'Sourdough and pastries', source: MAPS },
        contacts: [
          {
            type: 'instagram',
            value: 'https://instagram.com/crumbs',
            verification: 'unverified',
            source: MAPS,
          },
        ],
        evidence: [{ fact: 'Bakes daily', points: 20, source: MAPS }],
        preScore: 75,
        fitScore: 82,
        pitch: { productId: null, productName: 'Cane sugar', reason: 'Bakes daily' },
      });
      expect(updated.stage).toBe('scored');
      expect(updated.domain).toBe('crumbs.example');
      const [stored] = await app.prospects.listProspects(RUN_1);
      expect(stored).toMatchObject({
        preScore: 75,
        fitScore: 82,
        website: { summary: 'Sourdough and pastries' },
        evidence: [{ fact: 'Bakes daily', points: 20, source: MAPS }],
        pitch: { productName: 'Cane sugar' },
      });
      expect(stored?.contacts.map((c) => c.type)).toEqual(['phone', 'instagram']);
    });

    test('§3a: lead_contact_verified for each email and phone check result', async () => {
      const { app, analytics } = await fresh();
      const [id] = await app.prospects.addProspects(RUN_1, BUSINESS, [bakery()]);
      if (!id) throw new Error('id');
      await app.prospects.updateProspect(id, {
        contacts: [
          verifiedEmail('a@x.example'),
          {
            type: 'phone',
            value: '512-555-0999',
            verification: 'invalid',
            source: TWILIO,
            checked: true,
          },
          {
            type: 'email',
            value: 'b@x.example',
            verification: 'unverified',
            source: ZEROBOUNCE,
            checked: true,
          },
        ],
      });
      expect(
        analytics.events.filter((e) => e.name === 'lead_contact_verified').map((e) => e.properties),
      ).toEqual([
        { run_id: RUN_1, type: 'email', result: 'verified' },
        { run_id: RUN_1, type: 'phone', result: 'invalid' },
        { run_id: RUN_1, type: 'email', result: 'unknown' },
      ]);
    });

    test('unknown Prospect → NotFoundError', async () => {
      const { app } = await fresh();
      await expect(app.prospects.updateProspect(UNKNOWN_ID, { preScore: 1 })).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe(`[${storage}] FR-25: qualification and delivery`, () => {
    test('qualified Prospects become Leads ranked by Fit score, capped at max leads, with Sources', async () => {
      const { app } = await fresh();
      for (const fitScore of [70, 95, 40, 88, 66])
        await scoredProspect(app.prospects, { fitScore });
      const result = await app.prospects.deliver(deliverCommand({ maxLeads: 3 }));
      expect(result).toEqual({ delivered: 3 });
      const page = await app.queries.listLeads(owner(), PLAN, { sort: 'score', limit: 50 });
      expect(page.items.map((l) => l.fitScore)).toEqual([95, 88, 70]);
      const lead = await app.queries.getLead(owner(), page.items[0]?.id ?? '');
      expect(leadContract.parse(lead)).toEqual(lead);
      expect(lead.contacts.every((c) => c.source.name.length > 0)).toBe(true);
      expect(lead.evidence).toEqual([
        { fact: 'Bakes bread on site every morning', points: 20, source: MAPS },
        {
          fact: 'Independent, one location',
          points: 10,
          source: { ...MAPS, url: 'https://site.example' },
        },
      ]);
      expect(lead.pitch).toMatchObject({
        productName: 'Cane sugar, 50 lb bag',
        reason: 'Bakes daily',
      });
      expect(lead.pitch.productId).not.toBeNull();
      expect(lead.distanceMiles).toBeGreaterThan(0);
    });

    test('AC: a Prospect with Fit score 85 but only an invalid email and no phone is not delivered', async () => {
      const { app } = await fresh();
      await scoredProspect(app.prospects, {
        fitScore: 85,
        input: { phone: null },
        contacts: [
          {
            type: 'email',
            value: 'bad@x.example',
            verification: 'invalid',
            source: ZEROBOUNCE,
            checked: true,
          },
        ],
      });
      expect(await app.prospects.deliver(deliverCommand())).toEqual({ delivered: 0 });
      expect(
        (await app.queries.listLeads(owner(), PLAN, { sort: 'score', limit: 50 })).items,
      ).toEqual([]);
    });

    test('AC: a place delivered in an earlier run of the same Plan is not delivered again', async () => {
      const { app } = await fresh();
      await scoredProspect(app.prospects, {
        fitScore: 90,
        input: { placeKeys: ['google:SAME'], phone: null },
      });
      expect(await app.prospects.deliver(deliverCommand())).toEqual({ delivered: 1 });
      // Run 2 finds the same place through another provider key and the same website.
      await scoredProspect(app.prospects, {
        runId: RUN_2,
        fitScore: 92,
        input: { placeKeys: ['google:SAME', 'osm:node/9'], phone: null },
      });
      await scoredProspect(app.prospects, { runId: RUN_2, fitScore: 70 });
      expect([...(await app.prospects.alreadyDeliveredPlaceKeys(PLAN))]).toContain('google:SAME');
      expect(await app.prospects.deliver(deliverCommand({ runId: RUN_2 }))).toEqual({
        delivered: 1,
      });
      const all = await app.queries.listLeads(owner(), PLAN, { sort: 'score', limit: 50 });
      expect(all.items.map((l) => [l.fitScore, l.runId])).toEqual([
        [90, RUN_1],
        [70, RUN_2],
      ]);
    });

    test('found again by phone in a later run (no shared place id) is not delivered again', async () => {
      const { app } = await fresh();
      await scoredProspect(app.prospects, {
        fitScore: 90,
        input: { placeKeys: ['google:P1'], phone: '512-555-0177' },
      });
      await app.prospects.deliver(deliverCommand());
      await scoredProspect(app.prospects, {
        runId: RUN_2,
        fitScore: 90,
        input: { placeKeys: ['osm:other'], phone: '(512) 555-0177' },
      });
      expect(await app.prospects.deliver(deliverCommand({ runId: RUN_2 }))).toEqual({
        delivered: 0,
      });
    });

    test('a retried deliver creates nothing new and reports the run total', async () => {
      const { app } = await fresh();
      await scoredProspect(app.prospects, { fitScore: 90 });
      await scoredProspect(app.prospects, { fitScore: 80 });
      expect(await app.prospects.deliver(deliverCommand())).toEqual({ delivered: 2 });
      expect(await app.prospects.deliver(deliverCommand())).toEqual({ delivered: 2 });
      expect(
        (await app.queries.listLeads(owner(), PLAN, { sort: 'score', limit: 50 })).items,
      ).toHaveLength(2);
    });

    test('below the minimum, home listings and unverified-only are left out; unverified contacts kept as "Not verified", invalid dropped', async () => {
      const { app } = await fresh();
      await scoredProspect(app.prospects, { fitScore: 59 });
      await scoredProspect(app.prospects, { fitScore: 90, input: { listing: 'home' } });
      await scoredProspect(app.prospects, {
        fitScore: 90,
        contacts: [
          {
            type: 'email',
            value: 'maybe@x.example',
            verification: 'unverified',
            source: ZEROBOUNCE,
          },
        ],
      });
      await scoredProspect(app.prospects, {
        fitScore: 77,
        input: { phone: '512-555-0142' },
        contacts: [
          verifiedEmail('good@x.example'),
          { type: 'email', value: 'old@x.example', verification: 'invalid', source: ZEROBOUNCE },
        ],
      });
      expect(await app.prospects.deliver(deliverCommand())).toEqual({ delivered: 1 });
      const [only] = (await app.queries.listLeads(owner(), PLAN, { sort: 'score', limit: 50 }))
        .items;
      const lead = await app.queries.getLead(owner(), only?.id ?? '');
      expect(lead.fitScore).toBe(77);
      expect(lead.contacts.map((c) => [c.type, c.value, c.verification])).toEqual([
        ['phone', '512-555-0142', 'unverified'],
        ['email', 'good@x.example', 'verified'],
      ]);
    });

    test("a Plan of another Business can't be delivered to", async () => {
      const { app } = await fresh();
      await expect(
        app.prospects.deliver({ ...deliverCommand(), planId: OTHER_PLAN }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe(`[${storage}] FR-26: Lead list`, () => {
    test('filters: run, min score, Feedback, name search', async () => {
      const s = await delivered([92, 88, 84, 79]);
      await scoredProspect(s.app.prospects, {
        runId: RUN_2,
        fitScore: 71,
        input: { name: 'Little Loaf' },
      });
      await s.app.prospects.deliver(deliverCommand({ runId: RUN_2 }));
      const list = (q: Record<string, unknown>) =>
        s.app.queries.listLeads(owner(), PLAN, { sort: 'score', limit: 50, ...q });
      const all = await list({});
      expect(all.items).toHaveLength(5);
      for (const item of all.items) expect(leadSummary.parse(item)).toEqual(item);
      const [first, second] = all.items;
      await s.app.setFeedback.execute(owner(), first?.id ?? '', { value: 'good' });
      await s.app.setFeedback.execute(owner(), second?.id ?? '', {
        value: 'not_fit',
        reason: 'Closed',
      });
      expect((await list({ runId: RUN_2 })).items.map((l) => l.name)).toEqual(['Little Loaf']);
      expect((await list({ minScore: 84 })).items.map((l) => l.fitScore)).toEqual([92, 88, 84]);
      expect((await list({ feedback: 'good' })).items.map((l) => l.fitScore)).toEqual([92]);
      expect((await list({ feedback: 'not_fit' })).items.map((l) => l.fitScore)).toEqual([88]);
      expect((await list({ feedback: 'none' })).items.map((l) => l.fitScore)).toEqual([84, 79, 71]);
      expect((await list({ q: 'loaf' })).items.map((l) => l.name)).toEqual(['Little Loaf']);
      expect((await list({ q: '100%_' })).items).toEqual([]);
    });

    test('sorts: score, distance, newest', async () => {
      const s = await fresh();
      // Nearest has the lowest score; RUN_2 is delivered later.
      await scoredProspect(s.app.prospects, { fitScore: 90, input: { lat: 30.29, lng: -97.7262 } });
      await scoredProspect(s.app.prospects, {
        fitScore: 70,
        input: { lat: 30.263, lng: -97.7262 },
      });
      await scoredProspect(s.app.prospects, { fitScore: 80, input: { lat: null, lng: null } });
      await s.app.prospects.deliver(deliverCommand());
      s.clock.set(new Date('2026-11-20T12:00:00.000Z'));
      await scoredProspect(s.app.prospects, {
        runId: RUN_2,
        fitScore: 60,
        input: { lat: 30.27, lng: -97.7262 },
      });
      await s.app.prospects.deliver(deliverCommand({ runId: RUN_2 }));
      const scores = async (sort: 'score' | 'distance' | 'newest') =>
        (await s.app.queries.listLeads(owner(), PLAN, { sort, limit: 50 })).items.map(
          (l) => l.fitScore,
        );
      expect(await scores('score')).toEqual([90, 80, 70, 60]);
      expect(await scores('distance')).toEqual([70, 60, 90, 80]);
      expect((await scores('newest'))[0]).toBe(60);
    });

    test('cursor pagination walks every Lead once in each order', async () => {
      const s = await delivered([90, 90, 85, 80, 80, 80, 75, 70, 65, 60, 99]);
      for (const sort of ['score', 'distance', 'newest'] as const) {
        const seen: number[] = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
          const page = await s.app.queries.listLeads(owner(), PLAN, { sort, limit: 4, cursor });
          seen.push(...page.items.map((l) => l.fitScore));
          cursor = page.nextCursor ?? undefined;
          pages += 1;
        } while (cursor);
        expect(pages).toBe(3);
        expect(seen.sort()).toEqual([60, 65, 70, 75, 80, 80, 80, 85, 90, 90, 99].sort());
      }
      const first = await s.app.queries.listLeads(owner(), PLAN, { sort: 'score', limit: 4 });
      expect(first.items.map((l) => l.fitScore)).toEqual([99, 90, 90, 85]);
      await expect(
        s.app.queries.listLeads(owner(), PLAN, {
          sort: 'distance',
          limit: 4,
          cursor: first.nextCursor ?? '',
        }),
      ).rejects.toThrow(ValidationError);
      await expect(
        s.app.queries.listLeads(owner(), PLAN, { sort: 'score', limit: 4, cursor: 'garbage' }),
      ).rejects.toThrow(ValidationError);
    });

    test('stats: total, average Fit score, % verified contacts, credits, cost per lead', async () => {
      const s = await fresh();
      // Run 1: three verified emails and one unverified phone; run 2: one verified email.
      await scoredProspect(s.app.prospects, { fitScore: 90, input: { phone: null } });
      await scoredProspect(s.app.prospects, { fitScore: 80, input: { phone: null } });
      await scoredProspect(s.app.prospects, { fitScore: 71, input: { phone: '512-555-0150' } });
      await s.app.prospects.deliver(deliverCommand());
      await scoredProspect(s.app.prospects, { runId: RUN_2, fitScore: 60, input: { phone: null } });
      await s.app.prospects.deliver(deliverCommand({ runId: RUN_2 }));
      s.runCosts.byRun.set(RUN_1, { planId: PLAN, credits: 137 });
      s.runCosts.byRun.set(RUN_2, { planId: PLAN, credits: 40 });
      const all = await s.app.queries.listLeads(owner(), PLAN, { sort: 'score', limit: 2 });
      expect(all.stats).toEqual({
        total: 4,
        avgFitScore: 75.3,
        verifiedPct: 80,
        creditsSpent: 177,
        costPerLead: 44.25,
      });
      const run1 = await s.app.queries.listLeads(owner(), PLAN, {
        sort: 'score',
        limit: 50,
        runId: RUN_1,
      });
      expect(run1.stats).toEqual({
        total: 3,
        avgFitScore: 80.3,
        verifiedPct: 75,
        creditsSpent: 137,
        costPerLead: 45.67,
      });
      expect(s.runCosts.calls.at(-1)).toEqual({ businessId: BUSINESS, planId: PLAN, runId: RUN_1 });
    });

    test('an empty Plan has empty stats', async () => {
      const s = await fresh();
      const page = await s.app.queries.listLeads(owner(), PLAN, { sort: 'score', limit: 50 });
      expect(page).toEqual({
        items: [],
        nextCursor: null,
        stats: {
          total: 0,
          avgFitScore: null,
          verifiedPct: null,
          creditsSpent: 0,
          costPerLead: null,
        },
      });
    });

    test('leadsCounts per Plan for planning', async () => {
      const s = await delivered([90, 80]);
      expect(
        Object.fromEntries(await s.app.queries.leadsCounts(BUSINESS, [PLAN, OTHER_PLAN])),
      ).toEqual({ [PLAN]: 2 });
      expect((await s.app.queries.leadsCounts(OTHER_BUSINESS, [PLAN])).size).toBe(0);
      expect(
        Object.fromEntries(await s.app.queries.deliveredCounts([BUSINESS, OTHER_BUSINESS])),
      ).toEqual({ [BUSINESS]: 2 });
    });
  });

  describe(`[${storage}] cross-Business`, () => {
    test("Business B can't list, read, give Feedback on or export Business A's Leads", async () => {
      const s = await delivered([90]);
      const [item] = (await s.app.queries.listLeads(owner(), PLAN, { sort: 'score', limit: 50 }))
        .items;
      const id = item?.id ?? '';
      await expect(
        s.app.queries.listLeads(otherOwner(), PLAN, { sort: 'score', limit: 50 }),
      ).rejects.toThrow(NotFoundError);
      await expect(s.app.queries.getLead(otherOwner(), id)).rejects.toThrow(NotFoundError);
      await expect(s.app.setFeedback.execute(otherOwner(), id, { value: 'good' })).rejects.toThrow(
        NotFoundError,
      );
      await expect(
        s.app.queries.exportLeads(otherOwner(), PLAN, { sort: 'score' }),
      ).rejects.toThrow(NotFoundError);
      expect((await s.app.queries.getLead(owner(), id)).feedback).toBeNull();
    });

    test('Staff Acting as the Business see its Leads; a non-owner role is forbidden', async () => {
      const s = await delivered([90]);
      expect(
        (await s.app.queries.listLeads(actingAs(), PLAN, { sort: 'score', limit: 50 })).items,
      ).toHaveLength(1);
      await expect(
        s.app.queries.listLeads(owner({ roles: ['member'] }), PLAN, { sort: 'score', limit: 50 }),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe(`[${storage}] FR-27: Feedback`, () => {
    test('AC: Not a fit with "Closed" is kept on reload; change and clear', async () => {
      const s = await delivered([88]);
      const [item] = (await s.app.queries.listLeads(owner(), PLAN, { sort: 'score', limit: 50 }))
        .items;
      const id = item?.id ?? '';
      const marked = await s.app.setFeedback.execute(owner(), id, {
        value: 'not_fit',
        reason: 'Closed',
      });
      expect(marked).toMatchObject({ feedback: 'not_fit', feedbackReason: 'Closed' });
      expect(await s.app.queries.getLead(owner(), id)).toMatchObject({
        feedback: 'not_fit',
        feedbackReason: 'Closed',
      });
      expect(
        await s.app.setFeedback.execute(owner(), id, { value: 'good', reason: 'ignored' }),
      ).toMatchObject({
        feedback: 'good',
        feedbackReason: null,
      });
      expect(await s.app.setFeedback.execute(owner(), id, { value: null })).toMatchObject({
        feedback: null,
        feedbackReason: null,
      });
      expect(await s.app.queries.getLead(owner(), id)).toMatchObject({
        feedback: null,
        feedbackReason: null,
      });
    });

    test('§3a: lead_feedback_given with lead, run, value and Fit score; not on clear', async () => {
      const s = await delivered([88]);
      const [item] = (await s.app.queries.listLeads(owner(), PLAN, { sort: 'score', limit: 50 }))
        .items;
      const id = item?.id ?? '';
      await s.app.setFeedback.execute(owner(), id, { value: 'good' });
      await s.app.setFeedback.execute(owner(), id, { value: null });
      const events = s.analytics.events.filter((e) => e.name === 'lead_feedback_given');
      expect(events).toHaveLength(1);
      expect(events[0]?.properties).toEqual({
        lead_id: id,
        run_id: RUN_1,
        value: 'good',
        fit_score: 88,
      });
      expect(events[0]?.actor).toMatchObject({ businessId: BUSINESS });
    });

    test('unknown Lead → NotFoundError', async () => {
      const s = await fresh();
      await expect(
        s.app.setFeedback.execute(owner(), UNKNOWN_ID, { value: 'good' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe(`[${storage}] FR-28: CSV export`, () => {
    async function csv(
      s: Awaited<ReturnType<typeof fresh>>,
      filters: Record<string, unknown> = {},
    ) {
      const out = await s.app.queries.exportLeads(owner(), PLAN, { sort: 'score', ...filters });
      const rows: string[][] = [];
      for await (const row of out.rows) rows.push(row);
      return { fileName: out.fileName, rows };
    }

    test('header in contract order, one row per Lead, file name with the Plan slug and date', async () => {
      const s = await delivered([92, 88]);
      const { fileName, rows } = await csv(s);
      expect(fileName).toBe('llyner-leads-bakeries-near-austin-2026-11-19.csv');
      expect(rows[0]).toEqual([...leadCsvColumns]);
      expect(rows[0]).toEqual([
        'business_name',
        'category',
        'address',
        'distance_miles',
        'phone',
        'phone_verified',
        'email',
        'email_verified',
        'website',
        'instagram',
        'tiktok',
        'yelp',
        'fit_score',
        'pitch_product',
        'pitch_reason',
        'feedback',
        'sources',
        'delivered_at',
      ]);
      expect(rows).toHaveLength(3);
      const row = Object.fromEntries(leadCsvColumns.map((c, i) => [c, rows[1]?.[i]]));
      expect(row).toMatchObject({
        category: 'Bakery',
        fit_score: '92',
        phone_verified: 'no',
        email_verified: 'yes',
        pitch_product: 'Cane sugar, 50 lb bag',
        feedback: '',
        sources: 'https://maps.example/place/1;https://site.example',
        delivered_at: '2026-11-19T12:00:00.000Z',
      });
      expect(
        s.analytics.events.filter((e) => e.name === 'leads_exported').map((e) => e.properties),
      ).toEqual([{ plan_id: PLAN, leads_count: 2 }]);
    });

    test('AC: filter "good" exports the header and only the good Leads', async () => {
      const s = await delivered([92, 88, 84]);
      const page = await s.app.queries.listLeads(owner(), PLAN, { sort: 'score', limit: 50 });
      await s.app.setFeedback.execute(owner(), page.items[1]?.id ?? '', { value: 'good' });
      const { rows } = await csv(s, { feedback: 'good' });
      expect(rows.map((r) => r[12])).toEqual(['fit_score', '88']);
    });

    test('CSV injection: values starting with = + - @ are prefixed with a quote', async () => {
      const s = await fresh();
      await scoredProspect(s.app.prospects, {
        fitScore: 90,
        input: {
          name: '=HYPERLINK("http://evil.example","x")',
          category: '@SUM(1)',
          address: '-1 Main',
          phone: '+1 512 555 0123',
        },
      });
      await s.app.prospects.deliver(deliverCommand());
      const { rows } = await csv(s);
      const row = Object.fromEntries(leadCsvColumns.map((c, i) => [c, rows[1]?.[i]]));
      expect(row.business_name).toBe(`'=HYPERLINK("http://evil.example","x")`);
      expect(row.category).toBe(`'@SUM(1)`);
      expect(row.address).toBe(`'-1 Main`);
      expect(row.phone).toBe(`'+1 512 555 0123`);
    });

    test('exports more Leads than one batch, in order', async () => {
      const s = await fresh();
      const scores = Array.from({ length: 205 }, (_, i) => 60 + (i % 40));
      for (const fitScore of scores) await scoredProspect(s.app.prospects, { fitScore });
      await s.app.prospects.deliver(deliverCommand({ maxLeads: 500 }));
      const { rows } = await csv(s);
      expect(rows).toHaveLength(206);
      const exported = rows.slice(1).map((r) => Number(r[12]));
      expect(exported).toEqual([...scores].sort((a, b) => b - a));
    });
  });
}
