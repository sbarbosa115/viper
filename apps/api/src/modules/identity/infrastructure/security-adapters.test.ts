import { generate } from 'otplib';
import { createGuardrails } from 'otplib';
import { describe, expect, test } from 'vitest';
import {
  BcryptPasswordHasher,
  CryptoTokenService,
  OtplibTotpService,
} from './security-adapters.js';

const totp = new OtplibTotpService();
const seeded = 'JBSWY3DPEHPK3PXP';
const at = new Date('2026-11-19T10:00:00.000Z');
const epoch = Math.floor(at.getTime() / 1000);
const guardrails = createGuardrails({ MIN_SECRET_BYTES: 10 });
const codeAt = (secret: string, seconds: number) =>
  generate({ secret, epoch: seconds, guardrails });

describe('FR-5: TOTP adapter (otplib)', () => {
  const step = Math.floor(epoch / 30);

  test('accepts the current code for the seeded demo secret and returns its time step', async () => {
    expect(await totp.verify(seeded, await codeAt(seeded, epoch), at)).toBe(step);
  });

  test('accepts ±1 step (30 s) and rejects 2 steps away', async () => {
    expect(await totp.verify(seeded, await codeAt(seeded, epoch - 30), at)).toBe(step - 1);
    expect(await totp.verify(seeded, await codeAt(seeded, epoch + 30), at)).toBe(step + 1);
    expect(await totp.verify(seeded, await codeAt(seeded, epoch - 90), at)).toBeNull();
  });

  test('rejects malformed codes', async () => {
    expect(await totp.verify(seeded, 'abcdef', at)).toBeNull();
    expect(await totp.verify(seeded, '12345', at)).toBeNull();
  });

  test('new secrets are 20 bytes base32 and work end to end', async () => {
    const secret = totp.generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(await totp.verify(secret, await codeAt(secret, epoch), at)).toBe(step);
  });

  test('otpauth URL names Llyner Leads; the QR code is an SVG', async () => {
    const url = totp.otpauthUrl(seeded, 'staff@demo.test');
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain('Llyner');
    expect(url).toContain(`secret=${seeded}`);
    expect(await totp.qrSvg(url)).toContain('<svg');
  });
});

describe('NFR-4: password hashing and tokens', () => {
  test('bcrypt hashes verify and differ from the password', async () => {
    const hasher = new BcryptPasswordHasher(4);
    const hash = await hasher.hash('correct horse battery');
    expect(hash).not.toContain('correct');
    expect(await hasher.verify('correct horse battery', hash)).toBe(true);
    expect(await hasher.verify('wrong', hash)).toBe(false);
  });

  test('the production cost is 12', async () => {
    const hash = await new BcryptPasswordHasher().hash('x');
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  });

  test('tokens are 32 random bytes; the stored form is their sha-256', () => {
    const tokens = new CryptoTokenService();
    const t = tokens.generate();
    expect(Buffer.from(t, 'base64url')).toHaveLength(32);
    expect(tokens.generate()).not.toBe(t);
    expect(tokens.hash(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});
