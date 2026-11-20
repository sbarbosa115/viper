import { errorResponse } from '@app/contracts/errors';
import { getLead, leadCsvColumns, listLeads, setLeadFeedback } from '@app/contracts/leads';
import { describe, expect, test } from 'vitest';
import { buildTestApp } from '../../../../test/build-test-app.js';
import type { Actor } from '../../../shared/domain/actor.js';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import { createInMemoryLeads } from '../index.js';
import {
  deliverCommand,
  FakePlans,
  FakeRunCosts,
  otherOwner,
  owner,
  PLAN,
  RUN_1,
  scoredProspect,
  UNKNOWN_ID,
} from '../test/leads-fixture.js';

async function setup(actor?: Actor, scores: number[] = [92, 88, 71]) {
  const analytics = new RecordingAnalyticsTracker();
  const runCosts = new FakeRunCosts();
  const leads = createInMemoryLeads({
    clock: new FixedClock(new Date('2026-11-19T12:00:00.000Z')),
    ids: new SequentialIdGenerator(),
    analytics,
    plans: new FakePlans(),
    runCosts,
  });
  for (const fitScore of scores) await scoredProspect(leads.prospectStore, { fitScore });
  await leads.prospectStore.deliver(deliverCommand());
  runCosts.byRun.set(RUN_1, { planId: PLAN, credits: 120 });
  const app = await buildTestApp({ modules: [leads.module], ...(actor ? { actor } : {}) });
  const ids = (
    await leads.application.queries.listLeads(owner(), PLAN, { sort: 'score', limit: 50 })
  ).items.map((l) => l.id);
  return { app, leads, analytics, ids };
}

const code = (body: unknown) => errorResponse.parse(body).error.code;

describe('auth', () => {
  test('401 on every leads endpoint when not signed in', async () => {
    const { app } = await setup();
    const requests = [
      { method: 'GET', url: `/api/plans/${PLAN}/leads` },
      { method: 'GET', url: `/api/leads/${UNKNOWN_ID}` },
      { method: 'PUT', url: `/api/leads/${UNKNOWN_ID}/feedback`, payload: { value: 'good' } },
      { method: 'GET', url: `/api/plans/${PLAN}/leads.csv` },
    ] as const;
    for (const r of requests) {
      const res = await app.inject(r);
      expect(res.statusCode, r.url).toBe(401);
    }
  });
});

describe('FR-26: GET /api/plans/:id/leads', () => {
  test('200 with items, cursor and stats that parse against the contract', async () => {
    const { app } = await setup(owner());
    const res = await app.inject({ method: 'GET', url: `/api/plans/${PLAN}/leads?limit=2` });
    expect(res.statusCode).toBe(200);
    const body = listLeads.response.parse(res.json());
    expect(body.items.map((l) => l.fitScore)).toEqual([92, 88]);
    expect(body.nextCursor).not.toBeNull();
    expect(body.stats).toEqual({
      total: 3,
      avgFitScore: 83.7,
      verifiedPct: 50,
      creditsSpent: 120,
      costPerLead: 40,
    });
    const next = await app.inject({
      method: 'GET',
      url: `/api/plans/${PLAN}/leads?limit=2&cursor=${body.nextCursor ?? ''}`,
    });
    expect(listLeads.response.parse(next.json()).items.map((l) => l.fitScore)).toEqual([71]);
  });

  test('filters and sort come from the query string', async () => {
    const { app } = await setup(owner());
    const res = await app.inject({
      method: 'GET',
      url: `/api/plans/${PLAN}/leads?minScore=80&sort=distance&feedback=none&q=Bakery&runId=${RUN_1}`,
    });
    expect(
      listLeads.response
        .parse(res.json())
        .items.map((l) => l.fitScore)
        .sort(),
    ).toEqual([88, 92]);
  });

  test('400 on invalid filters or a bad cursor', async () => {
    const { app } = await setup(owner());
    for (const qs of ['minScore=101', 'sort=name', 'feedback=maybe', 'limit=0', 'cursor=nope']) {
      const res = await app.inject({ method: 'GET', url: `/api/plans/${PLAN}/leads?${qs}` });
      expect(res.statusCode, qs).toBe(400);
      expect(code(res.json())).toBe('VALIDATION_ERROR');
    }
  });

  test("404 for an unknown Plan and for another Business's Plan", async () => {
    const { app } = await setup(otherOwner());
    for (const id of [PLAN, UNKNOWN_ID]) {
      const res = await app.inject({ method: 'GET', url: `/api/plans/${id}/leads` });
      expect(res.statusCode).toBe(404);
      expect(code(res.json())).toBe('NOT_FOUND');
    }
  });
});

describe('FR-26: GET /api/leads/:id', () => {
  test('200 Lead with Contacts, Evidence and Sources', async () => {
    const { app, ids } = await setup(owner());
    const res = await app.inject({ method: 'GET', url: `/api/leads/${ids[0] ?? ''}` });
    expect(res.statusCode).toBe(200);
    const lead = getLead.response.parse(res.json());
    expect(lead.fitScore).toBe(92);
    expect(lead.contacts.length).toBeGreaterThan(0);
    expect(lead.evidence.every((e) => e.source.name)).toBe(true);
  });

  test("404 for another Business's Lead; 400 for a malformed id", async () => {
    const { app, ids } = await setup(otherOwner());
    expect(
      (await app.inject({ method: 'GET', url: `/api/leads/${ids[0] ?? ''}` })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/leads/not-an-id' })).statusCode).toBe(400);
  });
});

describe('FR-27: PUT /api/leads/:id/feedback', () => {
  test('sets, changes and clears Feedback; fires lead_feedback_given', async () => {
    const { app, ids, analytics } = await setup(owner());
    const url = `/api/leads/${ids[1] ?? ''}/feedback`;
    const res = await app.inject({
      method: 'PUT',
      url,
      payload: { value: 'not_fit', reason: 'Closed' },
    });
    expect(res.statusCode).toBe(200);
    expect(setLeadFeedback.response.parse(res.json())).toMatchObject({
      feedback: 'not_fit',
      feedbackReason: 'Closed',
    });
    const cleared = await app.inject({ method: 'PUT', url, payload: { value: null } });
    expect(cleared.json()).toMatchObject({ feedback: null, feedbackReason: null });
    expect(analytics.events.filter((e) => e.name === 'lead_feedback_given')).toHaveLength(1);
  });

  test('400 on an unknown value or a reason over 200 characters; 404 for another Business', async () => {
    const { app, ids } = await setup(owner());
    const url = `/api/leads/${ids[0] ?? ''}/feedback`;
    expect((await app.inject({ method: 'PUT', url, payload: { value: 'great' } })).statusCode).toBe(
      400,
    );
    expect(
      (
        await app.inject({
          method: 'PUT',
          url,
          payload: { value: 'not_fit', reason: 'x'.repeat(201) },
        })
      ).statusCode,
    ).toBe(400);
    const other = await setup(otherOwner());
    const res = await other.app.inject({
      method: 'PUT',
      url: `/api/leads/${other.ids[0] ?? ''}/feedback`,
      payload: { value: 'good' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('FR-28: GET /api/plans/:id/leads.csv', () => {
  test('streams UTF-8 CSV as an attachment named after the Plan and date', async () => {
    const { app, analytics } = await setup(owner());
    const res = await app.inject({ method: 'GET', url: `/api/plans/${PLAN}/leads.csv` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="llyner-leads-bakeries-near-austin-2026-11-19.csv"',
    );
    const lines = res.body.trimEnd().split('\r\n');
    expect(lines[0]).toBe(leadCsvColumns.join(','));
    expect(lines).toHaveLength(4);
    expect(analytics.events.find((e) => e.name === 'leads_exported')?.properties).toEqual({
      plan_id: PLAN,
      leads_count: 3,
    });
  });

  test('applies the list filters', async () => {
    const { app } = await setup(owner());
    const res = await app.inject({
      method: 'GET',
      url: `/api/plans/${PLAN}/leads.csv?minScore=90`,
    });
    expect(res.body.trimEnd().split('\r\n')).toHaveLength(2);
  });

  test('quotes fields with commas and guards formulas', async () => {
    const { app, leads } = await setup(owner(), []);
    await scoredProspect(leads.prospectStore, {
      fitScore: 90,
      input: { name: '=cmd|" /C calc"!A0', address: '1 Main St, Austin' },
    });
    await leads.prospectStore.deliver(deliverCommand());
    const res = await app.inject({ method: 'GET', url: `/api/plans/${PLAN}/leads.csv` });
    const row = res.body.split('\r\n')[1] ?? '';
    expect(row.startsWith(`"'=cmd|"" /C calc""!A0"`)).toBe(true);
    expect(row).toContain('"1 Main St, Austin"');
  });

  test("404 JSON for another Business's Plan", async () => {
    const { app } = await setup(otherOwner());
    const res = await app.inject({ method: 'GET', url: `/api/plans/${PLAN}/leads.csv` });
    expect(res.statusCode).toBe(404);
    expect(code(res.json())).toBe('NOT_FOUND');
  });
});
