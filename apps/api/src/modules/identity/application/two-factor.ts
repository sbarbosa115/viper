import type { Me } from '@app/contracts/identity';
import { ConflictError, ForbiddenError } from '../../../shared/domain/errors.js';
import { identityErrors } from '../domain/errors.js';
import type { Member } from '../domain/member.js';
import { rateLimits, windowStart } from '../domain/rate-limits.js';
import { halfSessionExhausted, sessionPolicy } from '../domain/session.js';
import type { IdentityServices } from './ports.js';
import { buildMe, requireActiveSession } from './session-context.js';

export interface TwoFactorSetupResult {
  otpauthUrl: string;
  secret: string;
  qrSvg: string;
}

/** FR-5: first Staff login: a new secret, shown as a QR code, confirmed by the first code. */
export class SetUpTwoFactor {
  constructor(private readonly s: IdentityServices) {}

  async execute(cmd: { token: string | undefined }): Promise<TwoFactorSetupResult> {
    const { member } = await requireActiveSession(this.s, cmd.token);
    if (!member.isStaff) throw new ForbiddenError('Two-factor is only for Staff');
    if (member.twoFactorSetUp) throw new ConflictError('Two-factor is already set up');
    const secret = this.s.totp.generateSecret();
    member.beginTwoFactorSetup(this.s.cipher.encrypt(secret));
    await this.s.uow.run((r) => r.members.save(member));
    const otpauthUrl = this.s.totp.otpauthUrl(secret, member.email);
    return { otpauthUrl, secret, qrSvg: await this.s.totp.qrSvg(otpauthUrl) };
  }
}

/**
 * FR-5: a valid code marks the session `two_factor_passed` (and confirms a pending setup).
 * - Wrong code → 401 INVALID_CODE; the 5th code on a half-session, if wrong, deletes it → 429.
 * - 10 wrong codes per Member per hour, across sessions, lock two-factor for an hour → 429
 *   TWO_FACTOR_LOCKED, written once to the Audit log.
 * - A code that already passed is refused within its window (replay).
 * Each code is counted (atomically, in SQL) before it is checked, so concurrent guesses can't
 * get more checks than the limits allow.
 */
export class VerifyTwoFactor {
  constructor(private readonly s: IdentityServices) {}

  async execute(cmd: { token: string | undefined; code: string; ip: string }): Promise<Me> {
    const { session, member } = await requireActiveSession(this.s, cmd.token);
    if (!member.isStaff) throw new ForbiddenError('Two-factor is only for Staff');
    if (session.twoFactorPassed) return buildMe(this.s.repos, session, member);
    const secretEnc = member.totpSecretEnc;
    if (!secretEnc) throw new ConflictError('Set up two-factor first');

    const now = this.s.clock.now();
    const { sessions, members, loginAttempts } = this.s.repos;
    const tries = await sessions.countTwoFactorAttempt(session.id);
    if (tries > sessionPolicy.maxTwoFactorAttempts) return this.endHalfSession(session.id);
    const lockedUntil = await members.twoFactorLockedUntil(member.id);
    if (lockedUntil && lockedUntil > now) {
      await sessions.delete(session.id);
      throw identityErrors.twoFactorLocked(secondsUntil(lockedUntil, now));
    }
    const perMember = rateLimits.twoFactorFailuresPerMember;
    const attemptId = await loginAttempts.recordTwoFactorAttempt(member.id, cmd.ip, now);
    const failures = await loginAttempts.countTwoFactorFailures(
      member.id,
      windowStart(now, perMember.windowMs),
    );
    if (failures > perMember.max) return this.lockOut(member, session.id, failures, now);

    const step = await this.s.totp.verify(this.s.cipher.decrypt(secretEnc), cmd.code, now);
    const fresh = step !== null && (await members.claimTotpStep(member.id, step));
    if (!fresh) {
      if (failures >= perMember.max) return this.lockOut(member, session.id, failures, now);
      if (halfSessionExhausted(tries)) return this.endHalfSession(session.id);
      throw identityErrors.invalidCode();
    }

    await loginAttempts.markTwoFactorPassed(attemptId);
    await this.s.uow.run(async (r) => {
      if (!member.twoFactorSetUp) {
        member.confirmTwoFactorSetup(now);
        await r.members.save(member);
      }
      session.passTwoFactor();
      await r.sessions.save(session);
    });
    return buildMe(this.s.repos, session, member);
  }

  /** The half-session used up its codes: deleted, the Member starts over (429). */
  private async endHalfSession(sessionId: string): Promise<never> {
    await this.s.repos.sessions.delete(sessionId);
    throw identityErrors.tooManyRequests(0);
  }

  private async lockOut(
    member: Member,
    sessionId: string,
    failures: number,
    now: Date,
  ): Promise<never> {
    const until = new Date(now.getTime() + rateLimits.twoFactorFailuresPerMember.windowMs);
    if (await this.s.repos.members.lockTwoFactor(member.id, until, now)) {
      await this.s.audit.record({
        staffMemberId: member.id,
        businessId: null,
        action: 'two_factor.locked',
        targetType: 'member',
        targetId: member.id,
        details: { failures, lockedUntil: until.toISOString() },
      });
    }
    await this.s.repos.sessions.delete(sessionId);
    const lockedUntil = (await this.s.repos.members.twoFactorLockedUntil(member.id)) ?? until;
    throw identityErrors.twoFactorLocked(secondsUntil(lockedUntil, now));
  }
}

function secondsUntil(at: Date, now: Date): number {
  return Math.max(1, Math.ceil((at.getTime() - now.getTime()) / 1000));
}
