import { errorResponse, insufficientCreditsError } from '@app/contracts/errors';
import {
  flow as flowContract,
  getQueueHealth,
  listFlows,
  listPlanRuns,
  listStaffRuns,
  runSummary,
  staffRunDetail,
} from '@app/contracts/research';
import { describe, expect, test } from 'vitest';
import { buildTestApp } from '../../../../test/build-test-app.js';
import type { Actor } from '../../../shared/domain/actor.js';
import { LOCAL_BUYERS_V1, TOOL_KEYS } from '../domain/local-buyers.js';
import { createResearchWith } from '../index.js';
import {
  actingAs,
  OTHER_BUSINESS,
  owner,
  PLAN,
  researchFixture,
  staff,
  UNKNOWN_ID,
  type ResearchFixture,
} from '../test/research-fixture.js';

async function setup(actor?: Actor, options: { credits?: number; testHooks?: boolean } = {}) {
  const f = await researchFixture(
    options.credits !== undefined ? { credits: options.credits } : {},
  );
  const research = createResearchWith({
    store: f.store,
    monitor: f.monitor,
    ...(options.testHooks ? { stopHook: f.stopHook } : {}),
    clock: f.clock,
    ids: f.ids,
    analytics: f.analytics,
    billing: f.billing.billingCommands,
    plans: f.plans,
    tools: f.tools,
    catalog: f.tools,
    toolCalls: f.tools,
    prospects: f.prospects,
    identity: f.identity,
    settings: f.settings,
    audit: f.audit,
    email: f.email,
    appUrl: 'http://localhost:5173',
  });
  const app = await buildTestApp({ modules: [research.module], ...(actor ? { actor } : {}) });
  return { app, f, research };
}

const code = (body: unknown) => errorResponse.parse(body).error.code;
const json = (res: { json(): unknown }) => res.json();

async function startedRun(f: ResearchFixture, actor = owner()) {
  return f.runs.start(actor, PLAN);
}

function flowBody(overrides: Record<string, unknown> = {}) {
  const { version: _v, ...rest } = LOCAL_BUYERS_V1;
  return { ...rest, ...overrides };
}

describe('auth', () => {
  test('401 on every research endpoint when not signed in', async () => {
    const { app } = await setup();
    const calls: [string, string][] = [
      ['POST', `/api/plans/${PLAN}/runs`],
      ['GET', `/api/plans/${PLAN}/runs`],
      ['GET', `/api/runs/${UNKNOWN_ID}`],
      ['POST', `/api/runs/${UNKNOWN_ID}/cancel`],
      ['POST', `/api/runs/${UNKNOWN_ID}/resume`],
      ['GET', '/api/staff/runs'],
      ['GET', `/api/staff/runs/${UNKNOWN_ID}`],
      ['POST', `/api/staff/runs/${UNKNOWN_ID}/resume`],
      ['GET', '/api/staff/queue'],
      ['GET', '/api/staff/flows'],
      ['GET', '/api/staff/flows/local-buyers'],
      ['PUT', '/api/staff/flows/local-buyers'],
    ];
    for (const [method, url] of calls) {
      const res = await app.inject({
        method: method as 'GET',
        url,
        ...(method === 'PUT' ? { payload: flowBody() } : {}),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  test('403 on Staff endpoints for an Owner', async () => {
    const { app } = await setup(owner());
    for (const url of [
      '/api/staff/runs',
      '/api/staff/queue',
      '/api/staff/flows',
      '/api/staff/flows/local-buyers',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(403);
    }
  });
});

describe('FR-18: POST /api/plans/:id/runs', () => {
  test('201 with the queued run; then 409 RUN_IN_PROGRESS', async () => {
    const { app, f } = await setup(owner());
    const res = await app.inject({ method: 'POST', url: `/api/plans/${PLAN}/runs` });
    expect(res.statusCode).toBe(201);
    expect(runSummary.parse(json(res))).toMatchObject({ status: 'queued', creditsReserved: 400 });
    expect(await f.billing.billingQueries.getWallet(owner().businessId)).toMatchObject({
      reserved: 400,
    });
    const again = await app.inject({ method: 'POST', url: `/api/plans/${PLAN}/runs` });
    expect(again.statusCode).toBe(409);
    expect(code(json(again))).toBe('RUN_IN_PROGRESS');
  });

  test('402 INSUFFICIENT_CREDITS with { available: 300, required: 400 }', async () => {
    const { app } = await setup(owner(), { credits: 300 });
    const res = await app.inject({ method: 'POST', url: `/api/plans/${PLAN}/runs` });
    expect(res.statusCode).toBe(402);
    expect(insufficientCreditsError.parse(json(res)).error.details).toEqual({
      available: 300,
      required: 400,
    });
  });

  test('403 EMAIL_NOT_VERIFIED, 404 another Business’s Plan, 503 RESEARCH_UNAVAILABLE, 400 bad id', async () => {
    const unverified = await setup(owner({ emailVerified: false }));
    let res = await unverified.app.inject({ method: 'POST', url: `/api/plans/${PLAN}/runs` });
    expect([res.statusCode, code(json(res))]).toEqual([403, 'EMAIL_NOT_VERIFIED']);

    const other = await setup(owner({ businessId: OTHER_BUSINESS }));
    res = await other.app.inject({ method: 'POST', url: `/api/plans/${PLAN}/runs` });
    expect([res.statusCode, code(json(res))]).toEqual([404, 'NOT_FOUND']);

    const down = await setup(owner());
    down.f.tools.unconfigured.add(TOOL_KEYS.claudePlanning);
    res = await down.app.inject({ method: 'POST', url: `/api/plans/${PLAN}/runs` });
    expect([res.statusCode, code(json(res))]).toEqual([503, 'RESEARCH_UNAVAILABLE']);

    res = await down.app.inject({ method: 'POST', url: '/api/plans/not-an-id/runs' });
    expect(res.statusCode).toBe(400);
  });
});

describe('FR-21: run status, list, cancel, Try again', () => {
  test('GET a run (scoped to the Business) and a Plan’s runs', async () => {
    const { app, f, research } = await setup(owner());
    const run = await startedRun(f);
    const res = await app.inject({ method: 'GET', url: `/api/runs/${run.id}` });
    expect(res.statusCode).toBe(200);
    expect(runSummary.parse(json(res)).id).toBe(run.id);
    const list = await app.inject({ method: 'GET', url: `/api/plans/${PLAN}/runs?limit=10` });
    expect(listPlanRuns.response.parse(json(list)).items.map((r) => r.id)).toEqual([run.id]);

    const otherApp = await buildTestApp({
      modules: [research.module],
      actor: owner({ businessId: OTHER_BUSINESS }),
    });
    const foreign = await otherApp.inject({ method: 'GET', url: `/api/runs/${run.id}` });
    expect([foreign.statusCode, code(json(foreign))]).toEqual([404, 'NOT_FOUND']);
    const foreignCancel = await otherApp.inject({
      method: 'POST',
      url: `/api/runs/${run.id}/cancel`,
    });
    expect(foreignCancel.statusCode).toBe(404);
    const foreignList = await otherApp.inject({ method: 'GET', url: `/api/plans/${PLAN}/runs` });
    expect(foreignList.statusCode).toBe(404);
  });

  test('cancel: 202 then 409 RUN_NOT_ACTIVE; Try again on a run that did not fail: 409 RUN_NOT_FAILED', async () => {
    const { app, f } = await setup(owner());
    const run = await startedRun(f);
    const res = await app.inject({ method: 'POST', url: `/api/runs/${run.id}/cancel` });
    expect(res.statusCode).toBe(202);
    expect(runSummary.parse(json(res)).status).toBe('cancelled');
    const again = await app.inject({ method: 'POST', url: `/api/runs/${run.id}/cancel` });
    expect([again.statusCode, code(json(again))]).toEqual([409, 'RUN_NOT_ACTIVE']);
    const resume = await app.inject({ method: 'POST', url: `/api/runs/${run.id}/resume` });
    expect([resume.statusCode, code(json(resume))]).toEqual([409, 'RUN_NOT_FAILED']);
  });

  test('Try again on a failed run: 202 queued; the response never shows Tool names', async () => {
    const { app, f } = await setup(owner());
    const run = await startedRun(f);
    f.tools.fail(TOOL_KEYS.firecrawl, 1, 'INSUFFICIENT_CREDITS');
    await f.executor.runAttempt(run.id);
    const res = await app.inject({ method: 'POST', url: `/api/runs/${run.id}/resume` });
    expect(res.statusCode).toBe(202);
    expect(runSummary.parse(json(res)).status).toBe('queued');
    expect(res.body).not.toContain('firecrawl');
  });

  test('Staff Acting as can start a run for the Business', async () => {
    const { app, f } = await setup(actingAs());
    const res = await app.inject({ method: 'POST', url: `/api/plans/${PLAN}/runs` });
    expect(res.statusCode).toBe(201);
    expect(
      f.store.run(runSummary.parse(json(res)).id)?.toSnapshot().startedByStaffId,
    ).not.toBeNull();
  });
});

describe('FR-32: Staff runs monitor', () => {
  test('list, detail, queue health and resume', async () => {
    const { app, f } = await setup(staff());
    const run = await startedRun(f, owner());
    f.tools.fail(TOOL_KEYS.instagram, 1, 'INSUFFICIENT_CREDITS');
    await f.executor.runAttempt(run.id);

    const list = await app.inject({ method: 'GET', url: '/api/staff/runs?status=failed' });
    expect(list.statusCode).toBe(200);
    expect(listStaffRuns.response.parse(json(list)).items[0]).toMatchObject({
      id: run.id,
      failureReason: 'INSUFFICIENT_CREDITS',
    });
    const detail = await app.inject({ method: 'GET', url: `/api/staff/runs/${run.id}` });
    expect(staffRunDetail.parse(json(detail)).attempts[0]?.outcome).toBe('final_error');
    const health = await app.inject({ method: 'GET', url: '/api/staff/queue' });
    expect(getQueueHealth.response.parse(json(health))).toMatchObject({ waiting: 1 });

    const resume = await app.inject({ method: 'POST', url: `/api/staff/runs/${run.id}/resume` });
    expect(resume.statusCode).toBe(202);
    expect(f.audit.entries.map((e) => e.action)).toEqual(['run.resumed']);
    const again = await app.inject({ method: 'POST', url: `/api/staff/runs/${run.id}/resume` });
    expect([again.statusCode, code(json(again))]).toEqual([409, 'RUN_NOT_FAILED']);
    const missing = await app.inject({ method: 'GET', url: `/api/staff/runs/${UNKNOWN_ID}` });
    expect(missing.statusCode).toBe(404);
  });
});

describe('FR-37: Staff Research flows', () => {
  test('list and get', async () => {
    const { app } = await setup(staff());
    const list = await app.inject({ method: 'GET', url: '/api/staff/flows' });
    expect(listFlows.response.parse(json(list)).items[0]).toMatchObject({
      key: 'local-buyers',
      version: 1,
    });
    const get = await app.inject({ method: 'GET', url: '/api/staff/flows/local-buyers' });
    expect(flowContract.parse(json(get)).steps).toHaveLength(10);
    const missing = await app.inject({ method: 'GET', url: '/api/staff/flows/unknown' });
    expect(missing.statusCode).toBe(404);
  });

  test('PUT saves a new version (201)', async () => {
    const { app, f } = await setup(staff());
    const res = await app.inject({
      method: 'PUT',
      url: '/api/staff/flows/local-buyers',
      payload: flowBody({ planDefaults: { maxCredits: 300, maxLeads: 50, minFitScore: 65 } }),
    });
    expect(res.statusCode).toBe(201);
    expect(flowContract.parse(json(res))).toMatchObject({
      version: 2,
      planDefaults: { maxCredits: 300 },
    });
    expect(f.audit.entries[0]).toMatchObject({ action: 'research_flow.updated' });
  });

  test('400 naming runSettings.maxTotalHours with the ceiling; 400 for shares not adding to 100%', async () => {
    const { app } = await setup(staff());
    const res = await app.inject({
      method: 'PUT',
      url: '/api/staff/flows/local-buyers',
      payload: flowBody({ runSettings: { ...LOCAL_BUYERS_V1.runSettings, maxTotalHours: 5 } }),
    });
    expect(res.statusCode).toBe(400);
    expect(errorResponse.parse(json(res)).error.fields).toEqual({
      'runSettings.maxTotalHours': 'Ceiling 4 h (Settings)',
    });

    const steps = LOCAL_BUYERS_V1.steps.map((s, i) => (i === 1 ? { ...s, budgetPct: 25 } : s));
    const shares = await app.inject({
      method: 'PUT',
      url: '/api/staff/flows/local-buyers',
      payload: flowBody({ steps }),
    });
    expect(shares.statusCode).toBe(400);
    expect(JSON.stringify(json(shares))).toContain('Step budget shares must add up to 100%');
  });
});

describe('test hook (ENABLE_TEST_HOOKS only)', () => {
  test('POST /api/test/research/stop-after sets the stop hook; absent without test hooks', async () => {
    const withHooks = await setup(owner(), { testHooks: true });
    const res = await withHooks.app.inject({
      method: 'POST',
      url: '/api/test/research/stop-after',
      payload: { stepKey: 'websites', items: 12 },
    });
    expect(res.statusCode).toBe(204);
    expect(withHooks.f.stopHook.hook).toEqual({ stepKey: 'websites', items: 12 });

    const without = await setup(owner());
    const missing = await without.app.inject({
      method: 'POST',
      url: '/api/test/research/stop-after',
      payload: { stepKey: 'websites', items: 1 },
    });
    expect(missing.statusCode).toBe(404);
  });
});
