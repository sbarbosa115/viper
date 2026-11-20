import { errorResponse } from '@app/contracts/errors';
import { listTools, updateTool } from '@app/contracts/tools';
import { describe, expect, test } from 'vitest';
import { buildTestApp } from '../../../../test/build-test-app.js';
import type { Actor } from '../../../shared/domain/actor.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { ListTools, UpdateTool, type ToolAudit } from '../application/tool-catalog.js';
import { createToolsModule, FakeToolControls, InMemoryFaultStore } from '../index.js';
import {
  catalogSnapshots,
  FakeSettings,
  InMemoryToolCallRepository,
  InMemoryToolRepository,
  NOW,
  ownerActor,
  staffActor,
} from '../test/fakes.js';

async function appWith(actor?: Actor, options: { testHooks?: boolean } = {}) {
  const tools = new InMemoryToolRepository(catalogSnapshots());
  const deps = {
    tools,
    calls: new InMemoryToolCallRepository(),
    settings: new FakeSettings(),
    clock: new FixedClock(NOW),
  };
  const audited: unknown[] = [];
  const audit: ToolAudit = { record: (e) => Promise.resolve(void audited.push(e)) };
  const store = new InMemoryFaultStore();
  const controls = new FakeToolControls(store);
  const app = await buildTestApp({
    modules: [
      createToolsModule({
        listTools: new ListTools(deps),
        updateTool: new UpdateTool({ ...deps, audit }),
        testHooks: options.testHooks ? { controls } : undefined,
      }),
    ],
    ...(actor ? { actor } : {}),
  });
  return { app, tools, audited, store };
}

describe('FR-23: GET /api/staff/tools', () => {
  test('Staff get every Tool; the response parses against the contract', async () => {
    const { app } = await appWith(staffActor);
    const res = await app.inject({ method: 'GET', url: '/api/staff/tools' });
    expect(res.statusCode).toBe(200);
    const body = listTools.response.parse(res.json());
    expect(body.items).toHaveLength(18);
    expect(body.items.find((t) => t.key === 'apify.yelp')).toMatchObject({
      enabled: true,
      configured: true,
    });
  });

  test('401 signed out, 403 for an Owner', async () => {
    expect(
      (await (await appWith()).app.inject({ method: 'GET', url: '/api/staff/tools' })).statusCode,
    ).toBe(401);
    const res = await (
      await appWith(ownerActor)
    ).app.inject({ method: 'GET', url: '/api/staff/tools' });
    expect(res.statusCode).toBe(403);
    expect(errorResponse.parse(res.json()).error.code).toBe('FORBIDDEN');
  });
});

describe('FR-23: PATCH /api/staff/tools/:key', () => {
  test('AJ-7: disables Apify Yelp and reprices Places; audited', async () => {
    const { app, audited } = await appWith(staffActor);
    const yelp = await app.inject({
      method: 'PATCH',
      url: '/api/staff/tools/apify.yelp',
      payload: { enabled: false },
    });
    expect(yelp.statusCode).toBe(200);
    expect(updateTool.response.parse(yelp.json()).enabled).toBe(false);
    const places = await app.inject({
      method: 'PATCH',
      url: '/api/staff/tools/google.places-text-search',
      payload: { creditsPerUnit: 10 },
    });
    expect(updateTool.response.parse(places.json())).toMatchObject({
      creditsPerUnit: 10,
      marginPct: 65,
    });
    expect(audited).toHaveLength(2);
  });

  test('400 for an empty body, an out-of-range price or too many decimals', async () => {
    const { app } = await appWith(staffActor);
    const url = '/api/staff/tools/apify.yelp';
    for (const payload of [
      {},
      { creditsPerUnit: 0 },
      { providerCostMicrosPerUnit: -1 },
      { creditsPerUnit: 1.2345 },
    ]) {
      const res = await app.inject({ method: 'PATCH', url, payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(errorResponse.parse(res.json()).error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('404 for an unknown Tool; 403 for an Owner', async () => {
    const { app } = await appWith(staffActor);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/staff/tools/nope.tool',
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(404);
    const owner = await appWith(ownerActor);
    expect(
      (
        await owner.app.inject({
          method: 'PATCH',
          url: '/api/staff/tools/apify.yelp',
          payload: { enabled: false },
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('AJ-5: POST /api/test/tools/fail (test hooks only)', () => {
  test('sets and resets error modes', async () => {
    const { app, store } = await appWith(undefined, { testHooks: true });
    const fail = await app.inject({
      method: 'POST',
      url: '/api/test/tools/fail',
      payload: { mode: 'failAlways', toolKey: 'google.places-text-search' },
    });
    expect(fail.statusCode).toBe(200);
    expect(await store.get('google.places-text-search')).toEqual({ mode: 'fail', remaining: null });
    await app.inject({
      method: 'POST',
      url: '/api/test/tools/fail',
      payload: { mode: 'failNext', toolKey: 'apify.google-maps', n: 2 },
    });
    expect(await store.get('apify.google-maps')).toEqual({ mode: 'fail', remaining: 2 });
    await app.inject({ method: 'POST', url: '/api/test/tools/fail', payload: { mode: 'reset' } });
    expect(await store.get('google.places-text-search')).toBeNull();
  });

  test('is not registered without test hooks', async () => {
    const { app } = await appWith(staffActor);
    const res = await app.inject({
      method: 'POST',
      url: '/api/test/tools/fail',
      payload: { mode: 'reset' },
    });
    expect(res.statusCode).toBe(404);
  });
});
