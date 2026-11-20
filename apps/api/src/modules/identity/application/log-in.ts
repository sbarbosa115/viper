import type { Me } from '@app/contracts/identity';
import { identityErrors } from '../domain/errors.js';
import { assertUnderLimit, rateLimits, windowStart } from '../domain/rate-limits.js';
import type { IdentityServices } from './ports.js';
import {
  buildMe,
  findActiveSession,
  newSession,
  requireActiveSession,
  type SignedIn,
} from './session-context.js';

/**
 * FR-3: email + password → a session. Staff get a half-session that only reaches the two-factor
 * endpoints. 5 failures per email or 20 per IP in 15 min → 429. Same error and cost for an
 * unknown email and a wrong password.
 */
export class LogIn {
  constructor(private readonly s: IdentityServices) {}

  async execute(cmd: { email: string; password: string; ip: string }): Promise<SignedIn> {
    const email = cmd.email.trim().toLowerCase();
    const now = this.s.clock.now();
    const { loginAttempts, members, sessions, businesses } = this.s.repos;
    const perEmail = rateLimits.loginFailuresPerEmail;
    const perIp = rateLimits.loginFailuresPerIp;
    assertUnderLimit(
      await loginAttempts.countFailuresForEmail(email, windowStart(now, perEmail.windowMs)),
      perEmail,
    );
    assertUnderLimit(
      await loginAttempts.countFailuresForIp(cmd.ip, windowStart(now, perIp.windowMs)),
      perIp,
    );

    const member = await members.findByEmail(email);
    let valid = false;
    if (member) {
      valid = await this.s.passwords.verify(cmd.password, member.passwordHash);
    } else {
      // Spend the same time as a real check, so timing does not reveal accounts.
      await this.s.passwords.hash(cmd.password);
    }
    await loginAttempts.record({ email, ip: cmd.ip, success: valid, at: now });
    if (!member || !valid) throw identityErrors.invalidCredentials();

    const { session, sessionToken } = newSession(this.s, member.id);
    await sessions.save(session);
    await businesses.touchActivity(member.businessId, now);
    return { me: await buildMe(this.s.repos, session, member), sessionToken };
  }
}

/** FR-3: deletes the session, which also ends any Acting as (FR-6, logged in the Audit log). */
export class LogOut {
  constructor(private readonly s: IdentityServices) {}

  /** Returns false when there was no active session. */
  async execute(cmd: { token: string | undefined }): Promise<boolean> {
    const active = await findActiveSession(this.s, cmd.token);
    if (!active) return false;
    const { session, member } = active;
    await this.s.repos.sessions.delete(session.id);
    if (session.actingAsBusinessId && member.isStaff) {
      await this.s.audit.record({
        staffMemberId: member.id,
        businessId: session.actingAsBusinessId,
        action: 'acting_as.stopped',
        targetType: 'business',
        targetId: session.actingAsBusinessId,
        details: { reason: 'logout' },
      });
    }
    return true;
  }
}

/** `GET /api/auth/me`: also answers half-sessions, so the app can show the two-factor step. */
export class GetMe {
  constructor(private readonly s: IdentityServices) {}

  async execute(cmd: { token: string | undefined }): Promise<Me> {
    const { session, member } = await requireActiveSession(this.s, cmd.token);
    return buildMe(this.s.repos, session, member);
  }
}
