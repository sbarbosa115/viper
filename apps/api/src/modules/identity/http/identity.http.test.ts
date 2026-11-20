import { errorResponse } from '@app/contracts/errors';
import { me as meSchema, twoFactorSetup } from '@app/contracts/identity';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, test } from 'vitest';
import { buildTestApp } from '../../../../test/build-test-app.js';
import { actorResolverFrom, identityModuleFrom } from '../index.js';
import { FakeTotp, fakeIdentity, type FakeIdentity } from '../test/fakes.js';
import { PASSWORD } from '../test/factories.js';

const ORIGIN = 'http://localhost:5173';
let s: FakeIdentity;
let app: FastifyInstance;

/** A stand-in for another module's routes: who does the Actor say we are? */
const probeModule = {
  name: 'probe',
  register(api: FastifyInstance) {
    api.get('/plans', { preHandler: api.authenticate }, (req) => ({
      businessId: req.actor?.businessId,
    }));
    api.post('/plans', { preHandler: api.authenticate }, () => ({ ok: true }));
    api.get('/staff/settings', { preHandler: api.authenticate }, (req) => {
      if (!req.actor?.roles.includes('staff')) {
        return Promise.reject(Object.assign(new Error('Staff only'), { statusCode: 403 }));
      }
      return { ok: true };
    });
  },
};

beforeEach(async () => {
  s = fakeIdentity();
  app = await buildTestApp({
    modules: [identityModuleFrom(s, { secure: false }), probeModule],
    deps: { resolveActor: actorResolverFrom(s) },
  });
});

let n = 0;
function signupBody(overrides: Record<string, unknown> = {}) {
  n += 1;
  return {
    businessName: `Business ${n}`,
    name: `Owner ${n}`,
    email: `owner${n}@example.com`,
    password: PASSWORD,
    ...overrides,
  };
}

function post(url: string, payload?: unknown, sid?: string) {
  return app.inject({
    method: 'POST',
    url,
    headers: { origin: ORIGIN, ...(sid ? { cookie: `sid=${sid}` } : {}) },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

function get(url: string, sid?: string) {
  return app.inject({ method: 'GET', url, headers: sid ? { cookie: `sid=${sid}` } : {} });
}

function sidOf(res: { cookies: { name: string; value: string }[] }): string {
  const sid = res.cookies.find((c) => c.name === 'sid')?.value;
  if (!sid) throw new Error('no sid cookie');
  return sid;
}

async function signUp(overrides: Record<string, unknown> = {}) {
  const body = signupBody(overrides);
  const res = await post('/api/auth/signup', body);
  expect(res.statusCode).toBe(201);
  return { body, sid: sidOf(res), me: meSchema.parse(res.json()) };
}

async function staffSession(): Promise<{ sid: string; email: string }> {
  const { body } = await signUp();
  await s.uow.run(async (r) => {
    const m = await r.members.findByEmail(body.email);
    m?.grantStaff();
    if (m) await r.members.save(m);
  });
  const login = await post('/api/auth/login', { email: body.email, password: PASSWORD });
  const sid = sidOf(login);
  expect((await post('/api/auth/two-factor/setup', undefined, sid)).statusCode).toBe(200);
  const verify = await post('/api/auth/two-factor/verify', { code: FakeTotp.validCode }, sid);
  expect(verify.statusCode).toBe(200);
  return { sid, email: body.email };
}

const code = (res: { json(): unknown }) => errorResponse.parse(res.json()).error.code;

describe('FR-1: POST /api/auth/signup', () => {
  test('201 with Me and a session cookie (httpOnly, SameSite=Lax, 30 days)', async () => {
    const res = await post('/api/auth/signup', signupBody({ email: 'Sam@Sweet.Example' }));
    expect(res.statusCode).toBe(201);
    const me = meSchema.parse(res.json());
    expect(me.member.email).toBe('sam@sweet.example');
    const cookie = res.cookies.find((c) => c.name === 'sid');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 2_592_000 });
    expect(s.email.sent).toHaveLength(1);
  });

  test('409 EMAIL_TAKEN for an existing email in any case', async () => {
    await signUp({ email: 'sam@sweet.example' });
    const res = await post('/api/auth/signup', signupBody({ email: 'SAM@sweet.example' }));
    expect(res.statusCode).toBe(409);
    expect(errorResponse.parse(res.json()).error).toMatchObject({
      code: 'EMAIL_TAKEN',
      message: 'An account with this email already exists. Log in or reset your password.',
    });
  });

  test('400 VALIDATION_ERROR naming password for a 9-character password', async () => {
    const res = await post('/api/auth/signup', signupBody({ password: '123456789' }));
    expect(res.statusCode).toBe(400);
    const { error } = errorResponse.parse(res.json());
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.fields).toHaveProperty('password');
  });

  test('429 after 5 sign-ups from one IP in an hour', async () => {
    for (let i = 0; i < 5; i += 1) await signUp();
    const res = await post('/api/auth/signup', signupBody());
    expect(res.statusCode).toBe(429);
    expect(code(res)).toBe('TOO_MANY_REQUESTS');
  });
});

describe('NFR-4: Origin check on state-changing requests', () => {
  test('a POST without Origin or from another site is 403; Referer from the app is accepted', async () => {
    const none = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: signupBody(),
    });
    expect(none.statusCode).toBe(403);
    const evil = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      headers: { origin: 'https://evil.example' },
      payload: signupBody(),
    });
    expect(evil.statusCode).toBe(403);
    const referer = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      headers: { referer: `${ORIGIN}/app/signup` },
      payload: signupBody(),
    });
    expect(referer.statusCode).toBe(201);
    expect(s.store.members.size).toBe(1);
  });

  test('GET needs no Origin', async () => {
    const { sid } = await signUp();
    expect((await get('/api/auth/me', sid)).statusCode).toBe(200);
  });
});

describe('FR-2: verify email', () => {
  test('POST /api/auth/verify-email: 200 then 410 for the used token', async () => {
    await signUp();
    const token = s.tokens.issued[0] ?? '';
    const first = await post('/api/auth/verify-email', { token });
    expect([first.statusCode, first.json()]).toEqual([200, { verified: true }]);
    const again = await post('/api/auth/verify-email', { token });
    expect([again.statusCode, code(again)]).toEqual([410, 'TOKEN_EXPIRED']);
    expect(s.store.events).toHaveLength(1);
  });

  test('resend: 401 signed out, 429 within 60 s, 202 after', async () => {
    expect((await post('/api/auth/verify-email/resend')).statusCode).toBe(401);
    const { sid } = await signUp();
    const soon = await post('/api/auth/verify-email/resend', undefined, sid);
    expect([soon.statusCode, code(soon)]).toEqual([429, 'TOO_MANY_REQUESTS']);
    s.clock.set(new Date(s.clock.now().getTime() + 60_000));
    const res = await post('/api/auth/verify-email/resend', undefined, sid);
    expect([res.statusCode, res.body]).toEqual([202, '']);
  });
});

describe('FR-3: log in and log out', () => {
  test('login sets a cookie and /api/auth/me returns the Member and Business', async () => {
    const { body, me } = await signUp();
    const res = await post('/api/auth/login', { email: body.email, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    const sid = sidOf(res);
    const meRes = await get('/api/auth/me', sid);
    expect(meRes.statusCode).toBe(200);
    expect(meSchema.parse(meRes.json())).toEqual(me);
  });

  test('401 INVALID_CREDENTIALS with the same message for a wrong password or unknown email', async () => {
    const { body } = await signUp();
    const wrong = await post('/api/auth/login', { email: body.email, password: 'not the one!' });
    const unknown = await post('/api/auth/login', { email: 'x@example.com', password: PASSWORD });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(code(wrong)).toBe('INVALID_CREDENTIALS');
  });

  test('after 5 wrong passwords a 6th (correct) try is 429', async () => {
    const { body } = await signUp();
    for (let i = 0; i < 5; i += 1) {
      await post('/api/auth/login', { email: body.email, password: 'not the one!' });
    }
    const res = await post('/api/auth/login', { email: body.email, password: PASSWORD });
    expect([res.statusCode, code(res)]).toEqual([429, 'TOO_MANY_REQUESTS']);
  });

  test('logout clears the cookie, then me is 401; logging out again is 401', async () => {
    const { sid } = await signUp();
    const res = await post('/api/auth/logout', undefined, sid);
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((c) => c.name === 'sid')?.value).toBe('');
    const me = await get('/api/auth/me', sid);
    expect([me.statusCode, code(me)]).toEqual([401, 'UNAUTHENTICATED']);
    expect((await post('/api/auth/logout', undefined, sid)).statusCode).toBe(401);
  });

  test('every customer endpoint is 401 without a session', async () => {
    expect((await get('/api/plans')).statusCode).toBe(401);
    expect((await get('/api/auth/me')).statusCode).toBe(401);
  });
});

describe('FR-4: password reset', () => {
  test('request is 202 for an unknown email and sends nothing', async () => {
    const res = await post('/api/auth/password-reset', { email: 'ghost@example.com' });
    expect([res.statusCode, s.email.sent.length]).toEqual([202, 0]);
  });

  test('confirm sets the password, old sessions stop working, a new session is set', async () => {
    const { body, sid: old } = await signUp();
    expect((await post('/api/auth/password-reset', { email: body.email })).statusCode).toBe(202);
    const token = s.tokens.issued.at(-1) ?? '';
    const res = await post('/api/auth/password-reset/confirm', {
      token,
      password: 'a brand new password',
    });
    expect(res.statusCode).toBe(200);
    meSchema.parse(res.json());
    expect((await get('/api/auth/me', old)).statusCode).toBe(401);
    expect((await get('/api/auth/me', sidOf(res))).statusCode).toBe(200);
    const again = await post('/api/auth/password-reset/confirm', {
      token,
      password: 'another new password',
    });
    expect([again.statusCode, code(again)]).toEqual([410, 'TOKEN_EXPIRED']);
  });

  test('PUT /api/auth/password: 401 wrong current, 400 short new, 204 success', async () => {
    const { sid } = await signUp();
    const put = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'PUT',
        url: '/api/auth/password',
        headers: { origin: ORIGIN, cookie: `sid=${sid}` },
        payload,
      });
    const wrong = await put({ currentPassword: 'nope nope nope', newPassword: 'a brand new one!' });
    expect([wrong.statusCode, code(wrong)]).toEqual([401, 'INVALID_CREDENTIALS']);
    const short = await put({ currentPassword: PASSWORD, newPassword: 'short' });
    expect(short.statusCode).toBe(400);
    expect(errorResponse.parse(short.json()).error.fields).toHaveProperty('newPassword');
    const ok = await put({ currentPassword: PASSWORD, newPassword: 'a brand new one!' });
    expect(ok.statusCode).toBe(204);
  });
});

describe('FR-5: Staff two-factor sign-in', () => {
  test('password step gives a half-session: twoFactor required, back office 403 TWO_FACTOR_REQUIRED', async () => {
    const { body } = await signUp();
    await s.uow.run(async (r) => {
      const m = await r.members.findByEmail(body.email);
      m?.grantStaff();
      if (m) await r.members.save(m);
    });
    const login = await post('/api/auth/login', { email: body.email, password: PASSWORD });
    expect(meSchema.parse(login.json()).twoFactor).toEqual({
      required: true,
      passed: false,
      setUp: false,
    });
    const sid = sidOf(login);
    const staff = await get('/api/staff/settings', sid);
    expect([staff.statusCode, code(staff)]).toEqual([403, 'TWO_FACTOR_REQUIRED']);
    const actingAs = await post('/api/staff/acting-as', { businessId: body.email }, sid);
    expect(code(actingAs)).toBe('TWO_FACTOR_REQUIRED');
    // Only the two-factor endpoints: customer endpoints see no Actor.
    expect((await get('/api/plans', sid)).statusCode).toBe(401);
    expect((await get('/api/auth/me', sid)).statusCode).toBe(200);

    const setup = await post('/api/auth/two-factor/setup', undefined, sid);
    expect(setup.statusCode).toBe(200);
    twoFactorSetup.response.parse(setup.json());
    const bad = await post('/api/auth/two-factor/verify', { code: '000000' }, sid);
    expect([bad.statusCode, code(bad)]).toEqual([401, 'INVALID_CODE']);
    const malformed = await post('/api/auth/two-factor/verify', { code: '12ab' }, sid);
    expect(malformed.statusCode).toBe(400);
    const good = await post('/api/auth/two-factor/verify', { code: FakeTotp.validCode }, sid);
    expect(meSchema.parse(good.json()).twoFactor).toEqual({
      required: true,
      passed: true,
      setUp: true,
    });
    expect((await get('/api/staff/settings', sid)).statusCode).toBe(200);
  });

  test('a non-Staff Member calling /api/staff/* gets 403', async () => {
    const { sid } = await signUp();
    expect((await get('/api/staff/settings', sid)).statusCode).toBe(403);
    const res = await post('/api/staff/acting-as', { businessId: crypto.randomUUID() }, sid);
    expect([res.statusCode, code(res)]).toEqual([403, 'FORBIDDEN']);
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/staff/acting-as',
      headers: { origin: ORIGIN, cookie: `sid=${sid}` },
    });
    expect(del.statusCode).toBe(403);
  });

  test('5 wrong codes delete the half-session (429), then 401', async () => {
    const { body } = await signUp();
    await s.uow.run(async (r) => {
      const m = await r.members.findByEmail(body.email);
      m?.grantStaff();
      if (m) await r.members.save(m);
    });
    const sid = sidOf(await post('/api/auth/login', { email: body.email, password: PASSWORD }));
    await post('/api/auth/two-factor/setup', undefined, sid);
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push(
        (await post('/api/auth/two-factor/verify', { code: '000000' }, sid)).statusCode,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 401, 429, 401]);
  });
});

describe('FR-6: Acting as, and cross-Business access', () => {
  test('a Member never acts on another Business; Staff Acting as see and act on it as its Owner', async () => {
    const a = await signUp({ businessName: 'Owner A Co' });
    const b = await signUp({ businessName: 'Sweet Supply Co' });
    const staff = await staffSession();

    // Owners see only their own Business.
    expect((await get('/api/plans', a.sid)).json()).toEqual({ businessId: a.me.business.id });
    const hijack = await post('/api/staff/acting-as', { businessId: b.me.business.id }, a.sid);
    expect(hijack.statusCode).toBe(403);
    expect((await get('/api/plans', a.sid)).json()).toEqual({ businessId: a.me.business.id });

    const start = await post('/api/staff/acting-as', { businessId: b.me.business.id }, staff.sid);
    expect(start.statusCode).toBe(200);
    const me = meSchema.parse(start.json());
    expect(me.actingAs).toEqual({ businessId: b.me.business.id, businessName: 'Sweet Supply Co' });
    expect((await get('/api/plans', staff.sid)).json()).toEqual({ businessId: b.me.business.id });
    expect(meSchema.parse((await get('/api/auth/me', staff.sid)).json()).actingAs).toEqual(
      me.actingAs,
    );
    // The back office stays reachable while Acting as.
    expect((await get('/api/staff/settings', staff.sid)).statusCode).toBe(200);
  });

  test('PUT /api/auth/password while Acting as is 403 ACTING_AS_FORBIDDEN', async () => {
    const b = await signUp();
    const staff = await staffSession();
    await post('/api/staff/acting-as', { businessId: b.me.business.id }, staff.sid);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/auth/password',
      headers: { origin: ORIGIN, cookie: `sid=${staff.sid}` },
      payload: { currentPassword: PASSWORD, newPassword: 'a brand new one!' },
    });
    expect([res.statusCode, code(res)]).toEqual([403, 'ACTING_AS_FORBIDDEN']);
  });

  test('404 for an unknown Business; DELETE stops and shows the own Business again', async () => {
    const b = await signUp();
    const staff = await staffSession();
    const missing = await post(
      '/api/staff/acting-as',
      { businessId: '00000000-0000-7000-8000-00000000ffff' },
      staff.sid,
    );
    expect([missing.statusCode, code(missing)]).toEqual([404, 'NOT_FOUND']);
    await post('/api/staff/acting-as', { businessId: b.me.business.id }, staff.sid);
    const stop = await app.inject({
      method: 'DELETE',
      url: '/api/staff/acting-as',
      headers: { origin: ORIGIN, cookie: `sid=${staff.sid}` },
    });
    expect(stop.statusCode).toBe(200);
    const me = meSchema.parse(stop.json());
    expect(me.actingAs).toBeNull();
    expect(me.business.id).not.toBe(b.me.business.id);
    expect(s.audit.entries.map((e) => e.action)).toEqual([
      'acting_as.started',
      'acting_as.stopped',
    ]);
  });

  test('a body that is not a UUID is 400', async () => {
    const staff = await staffSession();
    const res = await post('/api/staff/acting-as', { businessId: 'nope' }, staff.sid);
    expect(res.statusCode).toBe(400);
  });
});
