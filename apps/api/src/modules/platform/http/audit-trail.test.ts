import type { FastifyInstance } from 'fastify';
import { describe, expect, test } from 'vitest';
import { buildTestApp } from '../../../../test/build-test-app.js';
import type { Actor } from '../../../shared/domain/actor.js';
import { ForbiddenError } from '../../../shared/domain/errors.js';
import type { AuditRecord } from '../application/audit-log.js';
import { ids, ownerActor, staffActingAs, staffActor } from '../test/fakes.js';
import { registerAuditTrail } from './audit-trail.js';

const planId = '00000000-0000-7000-8000-0000000000aa';

/** Stand-in customer routes; the audit trail is registered on the same instance, as in app.ts. */
async function appWith(actor: Actor, recorder: { record(e: AuditRecord): Promise<void> }) {
  const customerRoutes = {
    name: 'customer-routes',
    register(app: FastifyInstance) {
      registerAuditTrail(app, { audit: recorder });
      app.put('/plans/:id', () => ({ ok: true }));
      app.get('/plans/:id', () => ({ ok: true }));
      app.post('/plans/:id/runs', (_req, reply) => reply.status(201).send({ ok: true }));
      app.post('/plans/:id/fail', () => {
        throw new ForbiddenError('nope');
      });
      app.post('/conversations/:id/messages', { config: { audit: false } }, () => ({ ok: true }));
      app.put('/profile', { config: { audit: { action: 'profile.edited' } } }, () => ({
        ok: true,
      }));
    },
  };
  return buildTestApp({ modules: [customerRoutes], actor });
}

function recording() {
  const entries: AuditRecord[] = [];
  return {
    entries,
    record(e: AuditRecord) {
      entries.push(e);
      return Promise.resolve();
    },
  };
}

describe('FR-7: audit trail for writes made while Acting as', () => {
  test("Staff Acting as B edits B's Plan → plan.updated with Staff, B and the plan id", async () => {
    const recorder = recording();
    const app = await appWith(staffActingAs(), recorder);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/plans/${planId}`,
      payload: { name: 'Bakeries', radiusMiles: 3 },
    });
    expect(res.statusCode).toBe(200);
    expect(recorder.entries).toEqual([
      {
        staffMemberId: ids.staff,
        businessId: ids.business,
        action: 'plan.updated',
        targetType: 'plan',
        targetId: planId,
        details: { method: 'PUT', route: '/api/plans/:id', fields: ['name', 'radiusMiles'] },
      },
    ]);
    expect(JSON.stringify(recorder.entries)).not.toContain('Bakeries');
  });

  test('starting a run records run.started', async () => {
    const recorder = recording();
    const app = await appWith(staffActingAs(), recorder);
    await app.inject({ method: 'POST', url: `/api/plans/${planId}/runs`, payload: {} });
    expect(recorder.entries.map((e) => e.action)).toEqual(['run.started']);
  });

  test('reads, failed writes and opted-out routes are not recorded', async () => {
    const recorder = recording();
    const app = await appWith(staffActingAs(), recorder);
    await app.inject({ method: 'GET', url: `/api/plans/${planId}` });
    const failed = await app.inject({ method: 'POST', url: `/api/plans/${planId}/fail` });
    expect(failed.statusCode).toBe(403);
    await app.inject({ method: 'POST', url: `/api/conversations/${planId}/messages`, payload: {} });
    expect(recorder.entries).toEqual([]);
  });

  test('a route can name its action', async () => {
    const recorder = recording();
    const app = await appWith(staffActingAs(), recorder);
    await app.inject({ method: 'PUT', url: '/api/profile', payload: { description: 'x' } });
    expect(recorder.entries[0]).toMatchObject({ action: 'profile.edited', targetType: 'profile' });
  });

  test('Owners and Staff not Acting as are not recorded by the hook', async () => {
    for (const actor of [ownerActor(), staffActor()]) {
      const recorder = recording();
      const app = await appWith(actor, recorder);
      await app.inject({ method: 'PUT', url: `/api/plans/${planId}`, payload: {} });
      expect(recorder.entries).toEqual([]);
    }
  });

  test('a failed audit write does not fail the request', async () => {
    const app = await appWith(staffActingAs(), {
      record: () => Promise.reject(new Error('db down')),
    });
    const res = await app.inject({ method: 'PUT', url: `/api/plans/${planId}`, payload: {} });
    expect(res.statusCode).toBe(200);
  });
});
