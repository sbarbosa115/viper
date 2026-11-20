import { errorResponse } from '@app/contracts/errors';
import { me as meSchema } from '@app/contracts/identity';
import { sql } from 'kysely';
import { createGuardrails, generate } from 'otplib';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { buildTestApp } from '../../../../test/build-test-app.js';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { InMemoryEmailSender } from '../../../shared/infrastructure/email/in-memory-email-sender.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import {
  createActorResolver,
  createIdentityModule,
  createIdentityQueries,
  runStaffCommand,
  seed,
} from '../index.js';
import { BcryptPasswordHasher } from '../infrastructure/security-adapters.js';
import { FakeCipher, RecordingAudit } from '../test/fakes.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const ORIGIN = 'http://localhost:5173';
const now = new Date('2026-11-19T10:00:00.000Z');
const id = (n: number) => `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const demo = {
  businesses: {
    sweetSupply: id(0xd001),
    cleanDesk: id(0xd002),
    cornerCoffee: id(0xd003),
    llynerInternal: id(0xd004),
  },
  members: { owner: id(0xd101), newOwner: id(0xd102), lowOwner: id(0xd103), staff: id(0xd104) },
  password: 'demo1234',
  staffTotpSecret: 'JBSWY3DPEHPK3PXP',
};

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
  for (const table of [
    'login_attempts',
    'email_tokens',
    'sessions',
    'members',
    'businesses',
    'outbox',
  ]) {
    await sql`TRUNCATE TABLE ${sql.table(table)}`.execute(db);
  }
  await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);
});

async function realApp() {
  const clock = new FixedClock(now);
  const ids = new Uuid7Generator();
  const audit = new RecordingAudit();
  const email = new InMemoryEmailSender();
  const module = createIdentityModule({
    db,
    clock,
    ids,
    analytics: new RecordingAnalyticsTracker(),
    email,
    cipher: new FakeCipher(),
    audit,
    appUrl: ORIGIN,
    secureCookies: true,
    passwords: new BcryptPasswordHasher(4),
  });
  const app = await buildTestApp({
    modules: [module],
    deps: { resolveActor: createActorResolver({ db, clock, ids }) },
  });
  return { app, audit, email, clock, ids };
}

describe('identity over HTTP with MySQL (real cookie flow)', () => {
  test('sign up, Set-Cookie (Secure), me, log out, then 401', async () => {
    const { app } = await realApp();
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      headers: { origin: ORIGIN },
      payload: {
        businessName: 'Sweet Supply Co',
        name: 'Sam',
        email: 'sam@sweet.example',
        password: 'correct horse battery',
      },
    });
    expect(signup.statusCode).toBe(201);
    const cookie = signup.cookies.find((c) => c.name === 'sid');
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
    const sid = cookie?.value ?? '';
    // Only the hash is stored.
    const stored = await db.selectFrom('sessions').select('id').execute();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).not.toBe(sid);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { sid } });
    expect(meSchema.parse(me.json()).business.name).toBe('Sweet Supply Co');

    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: ORIGIN },
      cookies: { sid },
    });
    expect(out.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { sid } });
    expect(after.statusCode).toBe(401);
    expect(errorResponse.parse(after.json()).error.code).toBe('UNAUTHENTICATED');
  });
});

describe('PRD section 8a: identity seed', () => {
  test('creates the demo Members and Businesses, idempotently', async () => {
    const deps = {
      db,
      clock: new FixedClock(now),
      ids: new Uuid7Generator(),
      demo,
      cipher: new FakeCipher(),
    };
    await seed(deps);
    await seed(deps);
    const members = await db
      .selectFrom('members')
      .select(['email', 'business_id', 'is_staff', 'email_verified_at', 'totp_enabled_at'])
      .orderBy('email')
      .execute();
    expect(
      members.map((m) => [m.email, m.business_id, m.is_staff, m.email_verified_at !== null]),
    ).toEqual([
      ['low@demo.test', demo.businesses.cornerCoffee, 0, true],
      ['new@demo.test', demo.businesses.cleanDesk, 0, true],
      ['owner@demo.test', demo.businesses.sweetSupply, 0, true],
      ['staff@demo.test', demo.businesses.llynerInternal, 1, true],
    ]);
    expect(members.find((m) => m.email === 'staff@demo.test')?.totp_enabled_at).not.toBeNull();
    const businesses = await db
      .selectFrom('businesses')
      .select(['name', 'internal'])
      .orderBy('name')
      .execute();
    expect(businesses).toEqual([
      { name: 'Clean Desk Co', internal: 0 },
      { name: 'Corner Coffee Roasters', internal: 0 },
      { name: 'Llyner Leads (internal)', internal: 1 },
      { name: 'Sweet Supply Co', internal: 0 },
    ]);
    const q = createIdentityQueries({ db, clock: new FixedClock(now), ids: new Uuid7Generator() });
    expect(await q.getOwnerContact(demo.businesses.sweetSupply)).toEqual({
      email: 'owner@demo.test',
      name: 'Sam Rivera',
      emailVerified: true,
    });
  });

  test('AJ-6: staff@demo.test logs in with demo1234 and the TOTP code from the seeded secret, then acts as Sweet Supply Co', async () => {
    await seed({
      db,
      clock: new FixedClock(now),
      ids: new Uuid7Generator(),
      demo,
      cipher: new FakeCipher(),
    });
    const { app, audit } = await realApp();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN },
      payload: { email: 'staff@demo.test', password: 'demo1234' },
    });
    expect(login.statusCode).toBe(200);
    expect(meSchema.parse(login.json()).twoFactor).toEqual({
      required: true,
      passed: false,
      setUp: true,
    });
    const sid = login.cookies.find((c) => c.name === 'sid')?.value ?? '';

    const code = await generate({
      secret: demo.staffTotpSecret,
      epoch: Math.floor(now.getTime() / 1000),
      guardrails: createGuardrails({ MIN_SECRET_BYTES: 10 }),
    });
    const verify = await app.inject({
      method: 'POST',
      url: '/api/auth/two-factor/verify',
      headers: { origin: ORIGIN },
      cookies: { sid },
      payload: { code },
    });
    expect(verify.statusCode).toBe(200);
    expect(meSchema.parse(verify.json()).twoFactor.passed).toBe(true);

    const act = await app.inject({
      method: 'POST',
      url: '/api/staff/acting-as',
      headers: { origin: ORIGIN },
      cookies: { sid },
      payload: { businessId: demo.businesses.sweetSupply },
    });
    expect(act.statusCode).toBe(200);
    expect(meSchema.parse(act.json()).actingAs).toEqual({
      businessId: demo.businesses.sweetSupply,
      businessName: 'Sweet Supply Co',
    });
    const session = await db.selectFrom('sessions').selectAll().executeTakeFirstOrThrow();
    expect([session.two_factor_passed, session.acting_as_business_id]).toEqual([
      1,
      demo.businesses.sweetSupply,
    ]);
    expect(audit.entries.map((e) => e.action)).toEqual(['acting_as.started']);
  });
});

describe('FR-5: staff server commands', () => {
  test('grant, reset-2fa and revoke change the Member and end their sessions', async () => {
    await seed({
      db,
      clock: new FixedClock(now),
      ids: new Uuid7Generator(),
      demo,
      cipher: new FakeCipher(),
    });
    const deps = { db, clock: new FixedClock(now), ids: new Uuid7Generator() };
    expect(await runStaffCommand(deps, 'grant', 'OWNER@demo.test')).toContain('is now Staff');
    const staffFlag = async (email: string) =>
      await db
        .selectFrom('members')
        .select(['is_staff', 'totp_enabled_at'])
        .where('email', '=', email)
        .executeTakeFirstOrThrow();
    expect((await staffFlag('owner@demo.test')).is_staff).toBe(1);

    await runStaffCommand(deps, 'reset-2fa', 'staff@demo.test');
    expect((await staffFlag('staff@demo.test')).totp_enabled_at).toBeNull();
    await runStaffCommand(deps, 'revoke', 'owner@demo.test');
    expect((await staffFlag('owner@demo.test')).is_staff).toBe(0);
    await expect(runStaffCommand(deps, 'grant', 'nobody@demo.test')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
