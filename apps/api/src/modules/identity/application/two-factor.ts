import type { Me } from '@app/contracts/identity';
import { ConflictError, ForbiddenError } from '../../../shared/domain/errors.js';
import { identityErrors } from '../domain/errors.js';
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
 * Wrong code → 401 INVALID_CODE; the 5th wrong code deletes the half-session → 429.
 */
export class VerifyTwoFactor {
  constructor(private readonly s: IdentityServices) {}

  async execute(cmd: { token: string | undefined; code: string }): Promise<Me> {
    const { session, member } = await requireActiveSession(this.s, cmd.token);
    if (!member.isStaff) throw new ForbiddenError('Two-factor is only for Staff');
    if (session.twoFactorPassed) return buildMe(this.s.repos, session, member);
    const secretEnc = member.totpSecretEnc;
    if (!secretEnc) throw new ConflictError('Set up two-factor first');

    const now = this.s.clock.now();
    const valid = await this.s.totp.verify(this.s.cipher.decrypt(secretEnc), cmd.code, now);
    if (!valid) {
      if (session.recordWrongCode() === 'exhausted') {
        await this.s.repos.sessions.delete(session.id);
        throw identityErrors.tooManyRequests(0);
      }
      await this.s.repos.sessions.save(session);
      throw identityErrors.invalidCode();
    }
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
}
