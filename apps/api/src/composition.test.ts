import type { FastifyInstance } from 'fastify';
import { describe, expect, test } from 'vitest';
import { buildTestApp } from '../test/build-test-app.js';
import { createAuditDirectory, createTotpCipher, unavailableAs503 } from './composition.js';
import { identityQueriesFrom } from './modules/identity/application/queries.js';
import { identityWorld } from './modules/identity/test/factories.js';
import { createSecretBox } from './modules/platform/index.js';
import { ValidationError } from './shared/domain/errors.js';

describe('composition: TOTP cipher on the SecretBox', () => {
  const box = createSecretBox({ NODE_ENV: 'test' });

  test('round-trips a secret and never stores it in clear', () => {
    const cipher = createTotpCipher(box);
    const sealed = cipher.encrypt('JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(cipher.decrypt(sealed)).toBe('JBSWY3DPEHPK3PXP');
  });

  test('a value sealed for another context does not decrypt', () => {
    const other = JSON.stringify(box.encrypt('JBSWY3DPEHPK3PXP', 'ai.anthropicApiKey'));
    expect(() => createTotpCipher(box).decrypt(other)).toThrow();
  });
});

describe('app: Origin check on /api writes (ADR 0004)', () => {
  const probe = {
    name: 'probe',
    register(app: FastifyInstance) {
      app.post('/probe', () => ({ ok: true }));
      app.post('/webhooks/stripe', () => ({ received: true }));
    },
  };

  test('rejects a write without the app origin, allows it with one', async () => {
    const app = await buildTestApp({ modules: [probe], originCheck: true });
    const without = await app.inject({ method: 'POST', url: '/api/probe' });
    expect(without.statusCode).toBe(403);
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/probe',
      headers: { origin: 'https://evil.example' },
    });
    expect(foreign.statusCode).toBe(403);
    const own = await app.inject({
      method: 'POST',
      url: '/api/probe',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(own.statusCode).toBe(200);
    await app.close();
  });

  test('the Stripe webhook and reads are exempt', async () => {
    const app = await buildTestApp({ modules: [probe], originCheck: true });
    expect((await app.inject({ method: 'POST', url: '/api/webhooks/stripe' })).statusCode).toBe(
      200,
    );
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    await app.close();
  });
});

describe('composition: Audit log directory from identity (no direct table reads)', () => {
  test("names Staff by email and Businesses by name through identity's queries", async () => {
    const w = identityWorld();
    const a = await w.owner({ businessName: 'Sweet Supply Co' });
    const found = await createAuditDirectory(identityQueriesFrom(w.s)).lookup({
      memberIds: [a.me.member.id, 'unknown'],
      businessIds: [a.me.business.id],
    });
    expect(found.members).toEqual(new Map([[a.me.member.id, { email: a.me.member.email }]]));
    expect(found.businesses).toEqual(new Map([[a.me.business.id, { name: 'Sweet Supply Co' }]]));
  });
});

describe('composition: geocoder failures', () => {
  const failing = (error: Error) => unavailableAs503({ search: () => Promise.reject(error) });

  test('no match stays an empty list', async () => {
    expect(await unavailableAs503({ search: () => Promise.resolve([]) }).search('nowhere')).toEqual(
      [],
    );
  });

  test('a provider failure is 503 GEOCODER_UNAVAILABLE, not a 500', async () => {
    await expect(
      failing(new Error('Google Geocoding: OVER_QUERY_LIMIT')).search('x'),
    ).rejects.toMatchObject({
      code: 'GEOCODER_UNAVAILABLE',
      status: 503,
    });
  });

  test('an app error passes through unchanged', async () => {
    const error = new ValidationError('bad');
    await expect(failing(error).search('x')).rejects.toBe(error);
  });
});
