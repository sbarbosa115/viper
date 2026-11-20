import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createGuardrails, generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import type { PasswordHasher, TokenService, TotpService } from '../application/ports.js';

/** bcryptjs, cost 12 (NFR-4, ADR 0004). Pure JS. */
export class BcryptPasswordHasher implements PasswordHasher {
  constructor(private readonly cost = 12) {}

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.cost);
  }

  verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}

/** 32 random bytes, base64url; stored as sha-256 hex. */
export class CryptoTokenService implements TokenService {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

const ISSUER = 'Llyner Leads';
const PERIOD_S = 30;
/**
 * The demo Staff secret `JBSWY3DPEHPK3PXP` (PRD section 8a) is 10 bytes, below otplib's default
 * 16-byte minimum. New secrets are 20 bytes; the guardrail only accepts the shorter seeded one.
 */
const guardrails = createGuardrails({ MIN_SECRET_BYTES: 10 });

/** TOTP (RFC 6238): SHA-1, 6 digits, 30 s, ±1 step (FR-5), with otplib. */
export class OtplibTotpService implements TotpService {
  generateSecret(): string {
    return generateSecret({ length: 20 });
  }

  async verify(secret: string, code: string, at: Date): Promise<number | null> {
    if (!/^\d{6}$/.test(code)) return null;
    const epoch = Math.floor(at.getTime() / 1000);
    const result = await verify({
      secret,
      token: code,
      epoch,
      epochTolerance: PERIOD_S,
      guardrails,
    });
    if (!result.valid) return null;
    // The RFC 6238 time step the code belongs to (the replay guard stores the last one used).
    return 'timeStep' in result ? result.timeStep : Math.floor(epoch / PERIOD_S) + result.delta;
  }

  otpauthUrl(secret: string, accountName: string): string {
    return generateURI({ issuer: ISSUER, label: accountName, secret });
  }

  qrSvg(otpauthUrl: string): Promise<string> {
    return QRCode.toString(otpauthUrl, { type: 'svg', margin: 1 });
  }
}
