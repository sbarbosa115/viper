import { errorResponse } from '@app/contracts/errors';
import { getDashboard, listCustomers, updateCustomer } from '@app/contracts/reporting';
import { describe, expect, test } from 'vitest';
import { buildTestApp } from '../../../../test/build-test-app.js';
import type { Actor } from '../../../shared/domain/actor.js';
import { createReporting } from '../index.js';
import { dashboardWorld, EXPECTED_DASHBOARD, IDS } from '../test/fixture.js';
import { fakeDeps, ownerActor, staffActor } from '../test/fakes.js';

async function appWith(actor?: Actor) {
  const deps = fakeDeps(dashboardWorld());
  const app = await buildTestApp({
    modules: [createReporting(deps).module],
    ...(actor ? { actor } : {}),
  });
  return { app, deps };
}

const ROUTES = [
  { method: 'GET' as const, url: '/api/staff/dashboard' },
  { method: 'GET' as const, url: '/api/staff/businesses' },
  {
    method: 'PATCH' as const,
    url: `/api/staff/businesses/${IDS.sweet}`,
    payload: { internal: true },
  },
];

describe('FR-30, FR-31: Staff only', () => {
  test.each(ROUTES)('$method $url: 401 signed out, 403 for an Owner', async (route) => {
    const signedOut = await (await appWith()).app.inject(route);
    expect(signedOut.statusCode).toBe(401);
    const owner = await (await appWith(ownerActor)).app.inject(route);
    expect(owner.statusCode).toBe(403);
    expect(errorResponse.parse(owner.json()).error.code).toBe('FORBIDDEN');
  });
});

describe('FR-30: GET /api/staff/dashboard', () => {
  test('defaults to 30 days; the response parses against the contract', async () => {
    const { app } = await appWith(staffActor);
    const res = await app.inject({ method: 'GET', url: '/api/staff/dashboard' });
    expect(res.statusCode).toBe(200);
    expect(getDashboard.response.parse(res.json())).toEqual(EXPECTED_DASHBOARD);
  });

  test('period 7d and 90d; an unknown period is 400', async () => {
    const { app } = await appWith(staffActor);
    for (const period of ['7d', '90d'] as const) {
      const res = await app.inject({ method: 'GET', url: `/api/staff/dashboard?period=${period}` });
      expect(res.statusCode).toBe(200);
      expect(getDashboard.response.parse(res.json()).period).toBe(period);
    }
    const bad = await app.inject({ method: 'GET', url: '/api/staff/dashboard?period=1y' });
    expect(bad.statusCode).toBe(400);
  });
});

describe('FR-31: GET /api/staff/businesses', () => {
  test('search "bakery" shows only matching Businesses', async () => {
    const { app } = await appWith(staffActor);
    const res = await app.inject({ method: 'GET', url: '/api/staff/businesses?q=bakery' });
    expect(res.statusCode).toBe(200);
    const body = listCustomers.response.parse(res.json());
    expect(body.items.map((c) => c.name)).toEqual(['Bakery Supplies Ltd']);
  });

  test('sort, limit and cursor are passed through; bad values are 400', async () => {
    const { app } = await appWith(staffActor);
    const first = listCustomers.response.parse(
      (
        await app.inject({ method: 'GET', url: '/api/staff/businesses?sort=lastActive&limit=2' })
      ).json(),
    );
    expect(first.items.map((c) => c.name)).toEqual(['Sweet Supply Co', 'Llyner Leads (internal)']);
    const second = listCustomers.response.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/staff/businesses?sort=lastActive&limit=2&cursor=${first.nextCursor ?? ''}`,
        })
      ).json(),
    );
    expect(second.items.map((c) => c.name)).toEqual([
      'Bakery Supplies Ltd',
      'Corner Coffee Roasters',
    ]);
    for (const qs of ['sort=name', 'limit=101', 'limit=0']) {
      const bad = await app.inject({ method: 'GET', url: `/api/staff/businesses?${qs}` });
      expect(bad.statusCode, qs).toBe(400);
    }
  });

  test('50 a page by default', async () => {
    const { app } = await appWith(staffActor);
    const body = listCustomers.response.parse(
      (await app.inject({ method: 'GET', url: '/api/staff/businesses' })).json(),
    );
    expect(body.items).toHaveLength(7);
    expect(body.nextCursor).toBeNull();
  });
});

describe('FR-31: PATCH /api/staff/businesses/:id', () => {
  test('marks a Business internal and returns the row', async () => {
    const { app, deps } = await appWith(staffActor);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/staff/businesses/${IDS.sweet}`,
      payload: { internal: true },
    });
    expect(res.statusCode).toBe(200);
    expect(updateCustomer.response.parse(res.json())).toMatchObject({
      id: IDS.sweet,
      internal: true,
    });
    expect(deps.audit.entries).toHaveLength(1);
  });

  test('unknown id 404, bad id or body 400', async () => {
    const { app } = await appWith(staffActor);
    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/staff/businesses/00000000-0000-4000-8000-00000000ffff',
      payload: { internal: true },
    });
    expect(missing.statusCode).toBe(404);
    expect(errorResponse.parse(missing.json()).error.code).toBe('NOT_FOUND');
    const badId = await app.inject({
      method: 'PATCH',
      url: '/api/staff/businesses/not-a-uuid',
      payload: { internal: true },
    });
    expect(badId.statusCode).toBe(400);
    const badBody = await app.inject({
      method: 'PATCH',
      url: `/api/staff/businesses/${IDS.sweet}`,
      payload: { internal: 'yes' },
    });
    expect(badBody.statusCode).toBe(400);
  });
});
