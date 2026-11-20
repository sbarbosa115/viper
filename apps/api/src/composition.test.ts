import type { FastifyInstance } from 'fastify';
import { describe, expect, test } from 'vitest';
import { buildTestApp } from '../test/build-test-app.js';
import { createTotpCipher } from './composition.js';
import { createSecretBox } from './modules/platform/index.js';

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
