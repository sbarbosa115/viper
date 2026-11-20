import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { InMemoryEmailSender } from '../../../shared/infrastructure/email/in-memory-email-sender.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import { identityQueriesFrom } from '../application/queries.js';
import { createIdentityUseCases } from '../application/use-cases.js';
import { Business } from '../domain/business.js';
import { EmailToken } from '../domain/email-token.js';
import { Member } from '../domain/member.js';
import { Session } from '../domain/session.js';
import {
  FakeCipher,
  FakePasswordHasher,
  FakeTotp,
  RecordingAudit,
  RecordingLogger,
  SequentialTokens,
} from '../test/fakes.js';
import { kyselyIdentityServices } from './kysely-identity.js';
import { kyselyIdentityRepos } from './kysely-repositories.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const now = new Date('2026-11-19T10:00:00.000Z');
let clock: FixedClock;
let ids: SequentialIdGenerator;

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  clock = new FixedClock(now);
  ids = new SequentialIdGenerator();
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

const repos = () => kyselyIdentityRepos(db, () => ids.next());

function services() {
  return kyselyIdentityServices({
    db,
    clock,
    ids,
    analytics: new RecordingAnalyticsTracker(),
    email: new InMemoryEmailSender(),
    cipher: new FakeCipher(),
    audit: new RecordingAudit(),
    logger: new RecordingLogger(),
    appUrl: 'http://localhost:5173',
    passwords: new FakePasswordHasher(),
    tokens: new SequentialTokens(),
    totp: new FakeTotp(),
  });
}

async function seedOwner(n: number, at = now) {
  const r = repos();
  const business = Business.create({ id: ids.next(), name: `Business ${n}`, now: at });
  const member = Member.registerOwner({
    id: ids.next(),
    businessId: business.id,
    email: `owner${n}@example.com`,
    name: `Owner ${n}`,
    passwordHash: 'hash',
    now: at,
  });
  await r.businesses.save(business);
  await r.members.save(member);
  return { business, member };
}

describe('identity repositories (MySQL)', () => {
  test('Business and Member round-trip, including Staff and the encrypted TOTP secret', async () => {
    const { business, member } = await seedOwner(1);
    member.grantStaff();
    member.verifyEmail(now);
    member.enableTwoFactorWith('enc:SECRET', now);
    await repos().members.save(member);
    business.markInternal(true);
    await repos().businesses.save(business);

    expect((await repos().members.findByEmail('owner1@example.com'))?.toSnapshot()).toEqual(
      member.toSnapshot(),
    );
    expect((await repos().members.findOwnerOf(business.id))?.id).toBe(member.id);
    expect((await repos().members.findOwnersOf([business.id])).map((m) => m.id)).toEqual([
      member.id,
    ]);
    expect((await repos().businesses.findById(business.id))?.toSnapshot()).toEqual(
      business.toSnapshot(),
    );
  });

  test('FR-1: a second Member with the same email is EMAIL_TAKEN, not an overwrite', async () => {
    const { member } = await seedOwner(1);
    const { business: other } = await seedOwner(2);
    const clash = Member.registerOwner({
      id: ids.next(),
      businessId: other.id,
      email: 'OWNER1@example.com',
      name: 'Impostor',
      passwordHash: 'x',
      now,
    });
    await expect(repos().members.save(clash)).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    expect((await repos().members.findByEmail('owner1@example.com'))?.name).toBe(member.name);
  });

  test('sessions round-trip, slide, and are deleted per Member except one', async () => {
    const { member, business } = await seedOwner(1);
    const r = repos();
    const a = Session.start({ id: 'a'.repeat(64), memberId: member.id, now });
    const b = Session.start({ id: 'b'.repeat(64), memberId: member.id, now });
    a.passTwoFactor();
    a.actAs(business.id);
    await r.sessions.save(a);
    await r.sessions.save(b);
    expect((await r.sessions.findById(a.id))?.toSnapshot()).toEqual(a.toSnapshot());
    a.touch(new Date(now.getTime() + 2 * 3_600_000));
    await r.sessions.save(a);
    expect((await r.sessions.findById(a.id))?.toSnapshot()).toEqual(a.toSnapshot());

    await r.sessions.deleteAllForMember(member.id, a.id);
    expect(await r.sessions.findById(b.id)).toBeNull();
    expect(await r.sessions.findById(a.id)).not.toBeNull();
    await r.sessions.delete(a.id);
    expect(await r.sessions.findById(a.id)).toBeNull();
  });

  test('email tokens: by hash, single use, counts and latest', async () => {
    const { member } = await seedOwner(1);
    const r = repos();
    const t1 = EmailToken.issue({
      id: ids.next(),
      memberId: member.id,
      purpose: 'reset',
      tokenHash: '1'.repeat(64),
      now,
    });
    const later = new Date(now.getTime() + 60_000);
    const t2 = EmailToken.issue({
      id: ids.next(),
      memberId: member.id,
      purpose: 'reset',
      tokenHash: '2'.repeat(64),
      now: later,
    });
    await r.emailTokens.save(t1);
    await r.emailTokens.save(t2);
    expect((await r.emailTokens.findByHash('1'.repeat(64)))?.toSnapshot()).toEqual(t1.toSnapshot());
    expect(await r.emailTokens.latestCreatedAt(member.id, 'reset')).toEqual(later);
    expect(await r.emailTokens.latestCreatedAt(member.id, 'verify')).toBeNull();
    expect(await r.emailTokens.countSince(member.id, 'reset', new Date(now.getTime() - 1))).toBe(2);
    t1.use(later);
    await r.emailTokens.save(t1);
    await r.emailTokens.markAllUsed(member.id, 'reset', later);
    expect((await r.emailTokens.findByHash('2'.repeat(64)))?.toSnapshot().usedAt).toEqual(later);
  });

  test('FR-1/FR-3: login attempts count failures per email and IP, and sign-ups per IP', async () => {
    const r = repos();
    const since = new Date(now.getTime() - 15 * 60_000);
    await r.loginAttempts.record({ email: 'a@x.co', ip: '1.1.1.1', success: false, at: now });
    await r.loginAttempts.record({ email: 'a@x.co', ip: '2.2.2.2', success: false, at: now });
    await r.loginAttempts.record({ email: 'a@x.co', ip: '1.1.1.1', success: true, at: now });
    await r.loginAttempts.record({ email: 'a@x.co', ip: '1.1.1.1', success: false, at: since });
    await r.loginAttempts.recordSignup('1.1.1.1', now);
    expect(await r.loginAttempts.countFailuresForEmail('a@x.co', since)).toBe(2);
    expect(await r.loginAttempts.countFailuresForIp('1.1.1.1', since)).toBe(1);
    expect(await r.loginAttempts.countSignupsForIp('1.1.1.1', since)).toBe(1);
    expect(await r.loginAttempts.countSignupsForIp('2.2.2.2', since)).toBe(0);
  });

  test('FR-31: the directory searches name or Owner email and paginates by cursor', async () => {
    for (let n = 1; n <= 5; n += 1) await seedOwner(n, new Date(now.getTime() + n * 1000));
    const q = identityQueriesFrom(services());
    const first = await q.listBusinesses({ sort: 'signedUp', limit: 2 });
    expect(first.items.map((i) => i.name)).toEqual(['Business 5', 'Business 4']);
    const second = await q.listBusinesses({
      sort: 'signedUp',
      limit: 2,
      cursor: first.nextCursor ?? '',
    });
    expect(second.items.map((i) => i.name)).toEqual(['Business 3', 'Business 2']);
    const third = await q.listBusinesses({
      sort: 'signedUp',
      limit: 2,
      cursor: second.nextCursor ?? '',
    });
    expect(third.items.map((i) => i.name)).toEqual(['Business 1']);
    expect(third.nextCursor).toBeNull();
    expect((await q.listBusinesses({ sort: 'signedUp', limit: 50, q: 'OWNER3@' })).items).toEqual([
      expect.objectContaining({
        name: 'Business 3',
        ownerEmail: 'owner3@example.com',
        verified: false,
      }),
    ]);
    expect((await q.listBusinesses({ sort: 'signedUp', limit: 50, q: '%' })).items).toEqual([]);
  });

  test('FR-2: verification commits the email and MemberEmailVerified in one transaction', async () => {
    const s = services();
    const uc = createIdentityUseCases(s);
    const { me } = await uc.signUp.execute({
      businessName: 'Sweet Supply Co',
      name: 'Sam',
      email: 'sam@sweet.example',
      password: 'correct horse battery',
      ip: '1.1.1.1',
    });
    const verifyToken = (s.tokens as SequentialTokens).issued[0] ?? '';
    await uc.verifyEmail.execute({ token: verifyToken });
    const events = await db.selectFrom('outbox').select(['type', 'payload']).execute();
    expect(events).toEqual([
      {
        type: 'MemberEmailVerified',
        payload: { memberId: me.member.id, businessId: me.business.id },
      },
    ]);
    await expect(uc.verifyEmail.execute({ token: verifyToken })).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
    expect(await db.selectFrom('outbox').select('id').execute()).toHaveLength(1);
  });

  test('a failed unit of work rolls back its writes and its events', async () => {
    const s = services();
    await expect(
      s.uow.run(async (r) => {
        await r.businesses.save(Business.create({ id: ids.next(), name: 'Rolled back', now }));
        await r.events.publish('MemberEmailVerified', { memberId: 'm', businessId: 'b' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.selectFrom('businesses').select('id').execute()).toEqual([]);
    expect(await db.selectFrom('outbox').select('id').execute()).toEqual([]);
  });
});
