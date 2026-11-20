import { Business } from '../domain/business.js';
import { EmailToken } from '../domain/email-token.js';
import { identityErrors } from '../domain/errors.js';
import { Member, memberEmail } from '../domain/member.js';
import { assertNewPassword } from '../domain/password-policy.js';
import { assertUnderLimit, rateLimits, windowStart } from '../domain/rate-limits.js';
import { sendSafely, verificationEmail } from './emails.js';
import type { IdentityServices } from './ports.js';
import { buildMe, newSession, type SignedIn } from './session-context.js';

export interface SignUpCommand {
  businessName: string;
  name: string;
  email: string;
  password: string;
  ip: string;
  /** Where the form was: the landing page card (FR-35) or the app. */
  source?: 'landing' | 'app';
}

/** FR-1: creates a Business, its Owner and a session, and sends the verification email. */
export class SignUp {
  constructor(private readonly s: IdentityServices) {}

  async execute(cmd: SignUpCommand): Promise<SignedIn> {
    assertNewPassword(cmd.password);
    const email = memberEmail(cmd.email);
    const now = this.s.clock.now();
    const recent = await this.s.repos.loginAttempts.countSignupsForIp(
      cmd.ip,
      windowStart(now, rateLimits.signupsPerIp.windowMs),
    );
    assertUnderLimit(recent, rateLimits.signupsPerIp);
    if (await this.s.repos.members.findByEmail(email)) throw identityErrors.emailTaken();

    const passwordHash = await this.s.passwords.hash(cmd.password);
    const verifyToken = this.s.tokens.generate();
    const business = Business.create({ id: this.s.ids.next(), name: cmd.businessName, now });
    const member = Member.registerOwner({
      id: this.s.ids.next(),
      businessId: business.id,
      email,
      name: cmd.name,
      passwordHash,
      now,
    });
    const signedInSession = newSession(this.s, member.id);

    await this.s.uow.run(async (r) => {
      if (await r.members.findByEmail(email)) throw identityErrors.emailTaken();
      await r.businesses.save(business);
      await r.members.save(member);
      await r.sessions.save(signedInSession.session);
      await r.emailTokens.save(
        EmailToken.issue({
          id: this.s.ids.next(),
          memberId: member.id,
          purpose: 'verify',
          tokenHash: this.s.tokens.hash(verifyToken),
          now,
        }),
      );
      await r.loginAttempts.recordSignup(cmd.ip, now);
    });

    await this.s.analytics.track({
      name: 'business_signed_up',
      actor: { memberId: member.id, businessId: business.id },
      properties: { business_id: business.id, source: cmd.source ?? 'app' },
    });
    await sendSafely(this.s, () =>
      this.s.email.send(
        verificationEmail({
          to: member.email,
          name: member.name,
          appUrl: this.s.appUrl,
          token: verifyToken,
        }),
      ),
    );
    return {
      me: await buildMe(this.s.repos, signedInSession.session, member),
      sessionToken: signedInSession.sessionToken,
    };
  }
}
