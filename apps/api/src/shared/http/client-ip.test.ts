import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, test } from 'vitest';
import { defaultTestDeps, testConfig } from '../../../test/build-test-app.js';
import { buildApp, type AppModule } from '../../app.js';
import type { Config } from '../../config/env.js';
import { identityModuleFrom } from '../../modules/identity/index.js';
import { fakeIdentity } from '../../modules/identity/test/fakes.js';
import { PASSWORD } from '../../modules/identity/test/factories.js';
import { clientIp } from './client-ip.js';

const echo: AppModule = {
  name: 'echo',
  register(api) {
    api.get('/whoami', (req) => ({ ip: clientIp(req) }));
  },
};

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function build(config: Partial<Config> = {}, modules: AppModule[] = [echo]) {
  app = await buildApp({ ...testConfig, ...config }, defaultTestDeps(), modules, {
    originCheck: false,
  });
  await app.ready();
  return app;
}

async function whoami(headers: Record<string, string>): Promise<string> {
  if (!app) throw new Error('build first');
  const res = await app.inject({
    method: 'GET',
    url: '/api/whoami',
    remoteAddress: '10.244.0.7', // the edge proxy, as the api's socket sees it
    headers,
  });
  return res.json<{ ip: string }>().ip;
}

describe('client IP from a trusted source (rate limits, login_attempts)', () => {
  test('one trusted hop: the edge-appended X-Forwarded-For entry, not the client-written ones', async () => {
    await build();
    expect(await whoami({ 'x-forwarded-for': '203.0.113.7' })).toBe('203.0.113.7');
    // The client prepends anything it likes; the edge appends the real address last.
    expect(await whoami({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' })).toBe('203.0.113.7');
    expect(await whoami({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8, 203.0.113.7' })).toBe(
      '203.0.113.7',
    );
    expect(await whoami({})).toBe('10.244.0.7');
  });

  test('TRUST_PROXY_HOPS=0 ignores X-Forwarded-For entirely', async () => {
    await build({ TRUST_PROXY_HOPS: 0 });
    expect(await whoami({ 'x-forwarded-for': '1.2.3.4' })).toBe('10.244.0.7');
  });

  test('CLIENT_IP_HEADER (do-connecting-ip) wins over X-Forwarded-For; a non-IP value is ignored', async () => {
    await build({ CLIENT_IP_HEADER: 'do-connecting-ip' });
    expect(
      await whoami({ 'do-connecting-ip': '198.51.100.9', 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }),
    ).toBe('198.51.100.9');
    expect(await whoami({ 'do-connecting-ip': 'not-an-ip', 'x-forwarded-for': '5.6.7.8' })).toBe(
      '5.6.7.8',
    );
  });

  test('a spoofed X-Forwarded-For does not reset the sign-up limit per IP (FR-1)', async () => {
    const s = fakeIdentity();
    await build({}, [identityModuleFrom(s, { secure: false })]);
    const signUp = (n: number) =>
      app?.inject({
        method: 'POST',
        url: '/api/auth/signup',
        remoteAddress: '10.244.0.7',
        headers: { 'x-forwarded-for': `10.0.0.${n}, 203.0.113.7` },
        payload: {
          businessName: `Business ${n}`,
          name: `Owner ${n}`,
          email: `owner${n}@example.com`,
          password: PASSWORD,
        },
      });
    for (let n = 1; n <= 5; n += 1) expect((await signUp(n))?.statusCode).toBe(201);
    expect((await signUp(6))?.statusCode).toBe(429);
    expect(new Set(s.store.attempts.map((a) => a.ip))).toEqual(new Set(['203.0.113.7']));
  });

  test('the global rate limit keys on the trusted address', async () => {
    await build();
    let last = 0;
    for (let n = 0; n < 301; n += 1) {
      const res = await app?.inject({
        method: 'GET',
        url: '/api/whoami',
        remoteAddress: '10.244.0.7',
        headers: { 'x-forwarded-for': `10.1.${Math.floor(n / 250)}.${n % 250}, 203.0.113.7` },
      });
      last = res?.statusCode ?? 0;
    }
    expect(last).toBe(429);
  });
});
