import { describe, expect, test } from 'vitest';
import { CodedError, ConflictError, ValidationError } from '../../../shared/domain/errors.js';
import { Business } from './business.js';
import { EmailToken } from './email-token.js';
import { Member } from './member.js';
import { assertNewPassword } from './password-policy.js';
import { assertResendGap, assertUnderLimit, rateLimits } from './rate-limits.js';
import { halfSessionExhausted, Session, sessionPolicy } from './session.js';
import { sessionAccess } from './session-access.js';

const now = new Date('2026-11-19T10:00:00.000Z');
const later = (ms: number) => new Date(now.getTime() + ms);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function owner(overrides: Partial<{ email: string; name: string }> = {}): Member {
  return Member.registerOwner({
    id: 'm1',
    businessId: 'b1',
    email: overrides.email ?? 'Sam@Sweet.Example',
    name: overrides.name ?? 'Sam',
    passwordHash: 'hash',
    now,
  });
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof CodedError || e instanceof ValidationError ? e.code : 'OTHER';
  }
  return undefined;
}

describe('FR-1: sign up (domain)', () => {
  test('a Business name is 2 to 120 characters, trimmed', () => {
    expect(Business.create({ id: 'b1', name: '  Sweet Supply Co ', now }).name).toBe(
      'Sweet Supply Co',
    );
    expect(() => Business.create({ id: 'b1', name: 'S', now })).toThrow(ValidationError);
    expect(() => Business.create({ id: 'b1', name: 'x'.repeat(121), now })).toThrow(
      ValidationError,
    );
  });

  test('the Owner email is stored lowercased; the name is 1 to 80 characters', () => {
    expect(owner().email).toBe('sam@sweet.example');
    expect(() => owner({ name: ' ' })).toThrow(ValidationError);
    expect(() => owner({ name: 'x'.repeat(81) })).toThrow(ValidationError);
    expect(() => owner({ email: 'nope' })).toThrow(ValidationError);
    expect(() => owner({ email: `${'a'.repeat(250)}@b.co` })).toThrow(ValidationError);
  });

  test('a new Owner is unverified, not Staff, without two-factor', () => {
    const m = owner();
    expect([m.emailVerified, m.isStaff, m.twoFactorSetUp]).toEqual([false, false, false]);
  });

  test('a 9-character password is rejected naming the field; 10 and 128 are fine', () => {
    try {
      assertNewPassword('x'.repeat(9));
      expect.fail('expected a ValidationError');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).details).toHaveProperty('password');
    }
    expect(() => assertNewPassword('x'.repeat(129))).toThrow(ValidationError);
    expect(() => assertNewPassword('correct horse')).not.toThrow();
    expect(() => assertNewPassword('y'.repeat(128))).not.toThrow();
  });

  test('common passwords are rejected', () => {
    expect(() => assertNewPassword('Password123')).toThrow(ValidationError);
  });

  test('5 sign-ups per IP per hour, the 6th is 429', () => {
    expect(() => assertUnderLimit(4, rateLimits.signupsPerIp)).not.toThrow();
    expect(codeOf(() => assertUnderLimit(5, rateLimits.signupsPerIp))).toBe('TOO_MANY_REQUESTS');
  });
});

describe('FR-2: verify email (domain)', () => {
  test('verifying twice reports no change the second time (no second grant)', () => {
    const m = owner();
    expect(m.verifyEmail(now)).toBe(true);
    expect(m.verifyEmail(later(1000))).toBe(false);
    expect(m.emailVerified).toBe(true);
  });

  test('a verification token is single-use and valid 24 h', () => {
    const t = EmailToken.issue({ id: 't', memberId: 'm1', purpose: 'verify', tokenHash: 'h', now });
    t.use(later(DAY - 1));
    expect(codeOf(() => t.use(later(DAY - 1)))).toBe('TOKEN_EXPIRED');
    const expired = EmailToken.issue({
      id: 't2',
      memberId: 'm1',
      purpose: 'verify',
      tokenHash: 'h2',
      now,
    });
    expect(codeOf(() => expired.use(later(DAY)))).toBe('TOKEN_EXPIRED');
  });

  test('a resend 30 s after the last email is 429; 60 s later is fine', () => {
    expect(codeOf(() => assertResendGap(now, later(30_000)))).toBe('TOO_MANY_REQUESTS');
    expect(() => assertResendGap(now, later(60_000))).not.toThrow();
    expect(() => assertResendGap(null, now)).not.toThrow();
  });
});

describe('FR-3: log in and log out (domain)', () => {
  test('5 failed logins for an email lock it; 20 per IP lock the IP', () => {
    expect(codeOf(() => assertUnderLimit(5, rateLimits.loginFailuresPerEmail))).toBe(
      'TOO_MANY_REQUESTS',
    );
    expect(() => assertUnderLimit(19, rateLimits.loginFailuresPerIp)).not.toThrow();
    expect(codeOf(() => assertUnderLimit(20, rateLimits.loginFailuresPerIp))).toBe(
      'TOO_MANY_REQUESTS',
    );
  });

  test('a session expires 30 days after its last use and after 14 idle days', () => {
    const s = Session.start({ id: 's', memberId: 'm1', now });
    expect(s.isActive(later(13 * DAY))).toBe(true);
    expect(s.isActive(later(14 * DAY))).toBe(false);
    expect(s.touch(later(10 * DAY))).toBe(true);
    expect(s.isActive(later(23 * DAY))).toBe(true);
    expect(s.toSnapshot().expiresAt).toEqual(later(10 * DAY + sessionPolicy.ttlMs));
  });

  test('a session is written at most once an hour', () => {
    const s = Session.start({ id: 's', memberId: 'm1', now });
    expect(s.touch(later(HOUR - 1))).toBe(false);
    expect(s.touch(later(HOUR))).toBe(true);
  });
});

describe('FR-4: password reset (domain)', () => {
  test('a reset token is valid 1 h and single-use', () => {
    const t = EmailToken.issue({ id: 't', memberId: 'm1', purpose: 'reset', tokenHash: 'h', now });
    expect(codeOf(() => t.use(later(HOUR)))).toBe('TOKEN_EXPIRED');
    const fresh = EmailToken.issue({
      id: 't2',
      memberId: 'm1',
      purpose: 'reset',
      tokenHash: 'h2',
      now,
    });
    fresh.use(later(HOUR - 1));
    expect(codeOf(() => fresh.use(later(HOUR - 1)))).toBe('TOKEN_EXPIRED');
  });

  test('3 reset requests per email per hour', () => {
    expect(() => assertUnderLimit(2, rateLimits.resetRequestsPerEmail)).not.toThrow();
    expect(codeOf(() => assertUnderLimit(3, rateLimits.resetRequestsPerEmail))).toBe(
      'TOO_MANY_REQUESTS',
    );
  });
});

describe('FR-5: Staff two-factor (domain)', () => {
  function staff(): Member {
    const m = owner();
    m.grantStaff();
    return m;
  }

  test('only Staff can set up two-factor, and only once', () => {
    expect(() => owner().beginTwoFactorSetup('enc')).toThrow(ConflictError);
    const m = staff();
    m.beginTwoFactorSetup('enc');
    expect(m.twoFactorSetUp).toBe(false);
    m.confirmTwoFactorSetup(now);
    expect(m.twoFactorSetUp).toBe(true);
    expect(() => m.beginTwoFactorSetup('enc2')).toThrow(ConflictError);
  });

  test('confirming without a secret is a conflict; reset clears the secret', () => {
    const m = staff();
    expect(() => m.confirmTwoFactorSetup(now)).toThrow(ConflictError);
    m.enableTwoFactorWith('enc', now);
    m.resetTwoFactor();
    expect([m.twoFactorSetUp, m.totpSecretEnc]).toEqual([false, null]);
  });

  test('the 5th code tried exhausts the half-session', () => {
    expect([1, 4, 5, 6].map(halfSessionExhausted)).toEqual([false, false, true, true]);
  });

  test('a Staff session without the code is a half-session with no Actor', () => {
    const s = Session.start({ id: 's', memberId: 'm1', now });
    expect(sessionAccess({ session: s, member: staff(), actingAs: null })).toEqual({
      kind: 'half',
    });
    s.passTwoFactor();
    const access = sessionAccess({ session: s, member: staff(), actingAs: null });
    expect(access.kind === 'full' && access.actor.roles).toEqual(['owner', 'staff']);
  });

  test('a Member who is not Staff never gets the staff role', () => {
    const s = Session.start({ id: 's', memberId: 'm1', now });
    s.passTwoFactor();
    const access = sessionAccess({ session: s, member: owner(), actingAs: null });
    expect(access).toEqual({
      kind: 'full',
      actor: { memberId: 'm1', businessId: 'b1', roles: ['owner'], emailVerified: false },
    });
  });
});

test('prd-support: a non-Owner Member gets the member role, not owner', () => {
  const s = Session.start({ id: 's', memberId: 'm1', now });
  const jo = Member.restore({ ...owner().toSnapshot(), role: 'member' });
  const access = sessionAccess({ session: s, member: jo, actingAs: null });
  expect(access.kind === 'full' && access.actor.roles).toEqual(['member']);
});

describe('FR-6: Acting as (domain)', () => {
  const target = Business.create({ id: 'b2', name: 'Clean Desk Co', now });
  const targetOwner = Member.registerOwner({
    id: 'm2',
    businessId: 'b2',
    email: 'new@demo.test',
    name: 'Nia',
    passwordHash: 'h',
    now,
  });
  targetOwner.verifyEmail(now);

  test('Staff Acting as resolve to the target Business as its Owner, with actingAs set', () => {
    const s = Session.start({ id: 's', memberId: 'm1', now });
    s.passTwoFactor();
    s.actAs('b2');
    const m = owner();
    m.grantStaff();
    const access = sessionAccess({
      session: s,
      member: m,
      actingAs: { business: target, owner: targetOwner },
    });
    expect(access).toEqual({
      kind: 'full',
      actor: {
        memberId: 'm1',
        businessId: 'b2',
        roles: ['owner', 'staff'],
        emailVerified: true,
        actingAs: { businessId: 'b2', businessName: 'Clean Desk Co', staffMemberId: 'm1' },
      },
    });
  });

  test('a Member who is not Staff cannot act as another Business', () => {
    const s = Session.start({ id: 's', memberId: 'm1', now });
    s.actAs('b2');
    const access = sessionAccess({
      session: s,
      member: owner(),
      actingAs: { business: target, owner: targetOwner },
    });
    expect(access.kind === 'full' && access.actor.businessId).toBe('b1');
  });

  test('starting another Business replaces the first; stopping clears it', () => {
    const s = Session.start({ id: 's', memberId: 'm1', now });
    s.actAs('b2');
    s.actAs('b3');
    expect(s.actingAsBusinessId).toBe('b3');
    s.stopActingAs();
    expect(s.actingAsBusinessId).toBeNull();
  });
});
