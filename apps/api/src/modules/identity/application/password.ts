import type { Actor } from '../../../shared/domain/actor.js';
import { UnauthenticatedError } from '../../../shared/domain/errors.js';
import { EmailToken } from '../domain/email-token.js';
import { identityErrors } from '../domain/errors.js';
import type { Member } from '../domain/member.js';
import { assertNewPassword } from '../domain/password-policy.js';
import { rateLimits, windowStart } from '../domain/rate-limits.js';
import { passwordResetEmail, sendSafely } from './emails.js';
import type { IdentityServices } from './ports.js';
import { buildMe, newSession, type SignedIn } from './session-context.js';

/**
 * FR-4: always succeeds (no account enumeration). Sends a 1-hour link if the account exists, at
 * most 3 per email per hour; requests over the limit are dropped silently for the same reason.
 */
export class RequestPasswordReset {
  constructor(private readonly s: IdentityServices) {}

  async execute(cmd: { email: string }): Promise<void> {
    const member = await this.s.repos.members.findByEmail(cmd.email.trim().toLowerCase());
    if (!member) return;
    const now = this.s.clock.now();
    const limit = rateLimits.resetRequestsPerEmail;
    const recent = await this.s.repos.emailTokens.countSince(
      member.id,
      'reset',
      windowStart(now, limit.windowMs),
    );
    if (recent >= limit.max) return;

    const token = this.s.tokens.generate();
    await this.s.uow.run((r) =>
      r.emailTokens.save(
        EmailToken.issue({
          id: this.s.ids.next(),
          memberId: member.id,
          purpose: 'reset',
          tokenHash: this.s.tokens.hash(token),
          now,
        }),
      ),
    );
    await sendSafely(this.s, () =>
      this.s.email.send(
        passwordResetEmail({ to: member.email, name: member.name, appUrl: this.s.appUrl, token }),
      ),
    );
  }
}

/**
 * FR-4: a valid token sets the new password, deletes all of the Member's sessions and signs them
 * in with a new one (Staff still need the two-factor step).
 */
export class ConfirmPasswordReset {
  constructor(private readonly s: IdentityServices) {}

  async execute(cmd: { token: string; password: string }): Promise<SignedIn> {
    assertNewPassword(cmd.password);
    const now = this.s.clock.now();
    const tokenHash = this.s.tokens.hash(cmd.token);
    const passwordHash = await this.s.passwords.hash(cmd.password);
    const signedIn = await this.s.uow.run(async (r) => {
      const token = await r.emailTokens.findByHash(tokenHash);
      if (token?.purpose !== 'reset') throw identityErrors.tokenExpired();
      token.use(now);
      await r.emailTokens.save(token);
      await r.emailTokens.markAllUsed(token.memberId, 'reset', now);
      const member = await r.members.findById(token.memberId);
      if (!member) throw identityErrors.tokenExpired();
      member.changePassword(passwordHash);
      await r.members.save(member);
      await r.sessions.deleteAllForMember(member.id);
      const fresh = newSession(this.s, member.id);
      await r.sessions.save(fresh.session);
      return { member, ...fresh };
    });
    return {
      me: await buildMe(this.s.repos, signedIn.session, signedIn.member),
      sessionToken: signedIn.sessionToken,
    };
  }
}

/**
 * FR-4: signed-in change with the current password. Blocked while Acting as (FR-6). Other sessions
 * of the Member are signed out; the current one stays.
 */
export class ChangePassword {
  constructor(private readonly s: IdentityServices) {}

  async execute(cmd: {
    actor: Actor;
    sessionToken: string | undefined;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    if (cmd.actor.actingAs) throw identityErrors.actingAsForbidden();
    assertNewPassword(cmd.newPassword, 'newPassword');
    const member: Member | null = await this.s.repos.members.findById(cmd.actor.memberId);
    if (!member) throw new UnauthenticatedError('Sign in required');
    if (!(await this.s.passwords.verify(cmd.currentPassword, member.passwordHash))) {
      throw identityErrors.invalidCredentials();
    }
    const passwordHash = await this.s.passwords.hash(cmd.newPassword);
    const keep = cmd.sessionToken ? this.s.tokens.hash(cmd.sessionToken) : undefined;
    await this.s.uow.run(async (r) => {
      member.changePassword(passwordHash);
      await r.members.save(member);
      await r.sessions.deleteAllForMember(member.id, keep);
    });
  }
}
