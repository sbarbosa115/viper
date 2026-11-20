import type { Actor } from '../../../shared/domain/actor.js';
import { EmailToken } from '../domain/email-token.js';
import { identityErrors } from '../domain/errors.js';
import type { Member } from '../domain/member.js';
import {
  assertResendGap,
  assertUnderLimit,
  rateLimits,
  windowStart,
} from '../domain/rate-limits.js';
import { sendSafely, verificationEmail } from './emails.js';
import type { IdentityServices } from './ports.js';

/**
 * FR-2: a single-use token verifies the email and publishes MemberEmailVerified in the same
 * transaction (billing grants the trial credits). Already verified: 200, no second event.
 */
export class VerifyEmail {
  constructor(private readonly s: IdentityServices) {}

  async execute(cmd: { token: string }): Promise<{ verified: true }> {
    const now = this.s.clock.now();
    const tokenHash = this.s.tokens.hash(cmd.token);
    const verified = await this.s.uow.run(async (r): Promise<Member | null> => {
      const token = await r.emailTokens.findByHash(tokenHash);
      if (token?.purpose !== 'verify') throw identityErrors.tokenExpired();
      token.use(now);
      // Conditional: of two requests with the same link, only one gets the row.
      if (!(await r.emailTokens.consume(token.id, now))) throw identityErrors.tokenExpired();
      const member = await r.members.findById(token.memberId);
      if (!member) throw identityErrors.tokenExpired();
      if (!member.verifyEmail(now)) return null;
      await r.members.save(member);
      await r.events.publish('MemberEmailVerified', {
        memberId: member.id,
        businessId: member.businessId,
      });
      return member;
    });
    if (verified) {
      await this.s.analytics.track({
        name: 'email_verified',
        actor: { memberId: verified.id, businessId: verified.businessId },
        properties: { business_id: verified.businessId },
      });
    }
    return { verified: true };
  }
}

/** FR-2: "Resend email" for a signed-in unverified Member: once per 60 s, 5 per day. */
export class ResendVerificationEmail {
  constructor(private readonly s: IdentityServices) {}

  async execute(cmd: { actor: Actor }): Promise<void> {
    const member = await this.s.repos.members.findById(cmd.actor.memberId);
    if (!member || member.emailVerified) return;
    const now = this.s.clock.now();
    const { emailTokens } = this.s.repos;
    assertResendGap(await emailTokens.latestCreatedAt(member.id, 'verify'), now);
    const perDay = rateLimits.verificationResendsPerDay;
    const sentToday = await emailTokens.countSince(
      member.id,
      'verify',
      windowStart(now, perDay.windowMs),
    );
    // The sign-up email is not a resend: 5 resends a day means 6 verification emails.
    assertUnderLimit(sentToday, { ...perDay, max: perDay.max + 1 });

    const token = this.s.tokens.generate();
    await this.s.uow.run((r) =>
      r.emailTokens.save(
        EmailToken.issue({
          id: this.s.ids.next(),
          memberId: member.id,
          purpose: 'verify',
          tokenHash: this.s.tokens.hash(token),
          now,
        }),
      ),
    );
    await sendSafely(this.s, () =>
      this.s.email.send(
        verificationEmail({ to: member.email, name: member.name, appUrl: this.s.appUrl, token }),
      ),
    );
  }
}
