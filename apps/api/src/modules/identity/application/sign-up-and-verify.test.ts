import { beforeEach, describe, expect, test } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors.js';
import { identityWorld, signupDetails } from '../test/factories.js';

let w: ReturnType<typeof identityWorld>;
beforeEach(() => {
  w = identityWorld();
});

/** The verification token from the latest email (the link carries it). */
function tokenFromLastEmail(): string {
  const text = w.s.email.sent.at(-1)?.text ?? '';
  const match = /token=([^\s&]+)/.exec(text);
  if (!match?.[1]) throw new Error('no link in the email');
  return decodeURIComponent(match[1]);
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return (e as { code?: string }).code ?? 'UNKNOWN';
  }
}

describe('FR-1: sign up', () => {
  test('creates a Business, its Owner and a session, and sends a verification email', async () => {
    const details = signupDetails({ email: 'Sam@Sweet.Example', businessName: 'Sweet Supply Co' });
    const { me, sessionToken } = await w.signUp.execute(details);

    expect(me.member).toMatchObject({
      name: details.name,
      email: 'sam@sweet.example',
      emailVerified: false,
      isStaff: false,
    });
    expect(me.business.name).toBe('Sweet Supply Co');
    expect(me.actingAs).toBeNull();
    expect(me.twoFactor).toEqual({ required: false, passed: false, setUp: false });
    expect(w.s.store.businesses.size).toBe(1);
    expect(w.s.store.members.size).toBe(1);
    // Signed in immediately.
    expect((await w.actorOf(sessionToken)).businessId).toBe(me.business.id);

    const mail = w.s.email.sent[0];
    expect(mail?.to).toBe('sam@sweet.example');
    expect(mail?.subject).toContain('Llyner Leads');
    expect(mail?.text).toContain('http://localhost:5173/app/verify-email?token=');
    expect(mail?.html).toContain('/app/verify-email?token=');
  });

  test('fires business_signed_up with source app by default, landing from the landing page', async () => {
    const { me } = await w.signUp.execute(signupDetails());
    await w.signUp.execute({ ...signupDetails(), source: 'landing' });
    expect(w.s.analytics.events.map((e) => [e.name, e.properties])).toEqual([
      ['business_signed_up', { business_id: me.business.id, source: 'app' }],
      ['business_signed_up', { business_id: expect.any(String), source: 'landing' }],
    ]);
  });

  test('an email that already exists (any case) is 409 EMAIL_TAKEN and nothing is created', async () => {
    await w.signUp.execute(signupDetails({ email: 'sam@sweet.example' }));
    const again = w.signUp.execute(signupDetails({ email: 'SAM@Sweet.example' }));
    expect(await codeOf(again)).toBe('EMAIL_TAKEN');
    expect(w.s.store.businesses.size).toBe(1);
    expect(w.s.store.members.size).toBe(1);
    expect(w.s.email.sent).toHaveLength(1);
  });

  test('a 9-character password is 400 VALIDATION_ERROR naming password', async () => {
    const err = await w.signUp
      .execute({ ...signupDetails(), password: '123456789' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details).toHaveProperty('password');
    expect(w.s.store.members.size).toBe(0);
  });

  test('sign-up is limited to 5 per IP per hour (429)', async () => {
    const ip = '203.0.113.9';
    for (let i = 0; i < 5; i += 1) await w.signUp.execute({ ...signupDetails(), ip });
    expect(await codeOf(w.signUp.execute({ ...signupDetails(), ip }))).toBe('TOO_MANY_REQUESTS');
    w.s.clock.set(new Date(w.s.clock.now().getTime() + 3_600_001));
    expect(await codeOf(w.signUp.execute({ ...signupDetails(), ip }))).toBe('OK');
  });

  test('a failing email does not fail the sign-up', async () => {
    w.s.email.send = () => Promise.reject(new Error('smtp down'));
    await expect(w.signUp.execute(signupDetails())).resolves.toBeDefined();
    expect(w.s.logger.warnings).toHaveLength(1);
  });
});

describe('FR-2: verify email', () => {
  test('a valid token verifies the email and publishes MemberEmailVerified (trial credits)', async () => {
    const { me, sessionToken } = await w.signUp.execute(signupDetails());
    await expect(w.verifyEmail.execute({ token: tokenFromLastEmail() })).resolves.toEqual({
      verified: true,
    });
    expect((await w.getMe.execute({ token: sessionToken })).member.emailVerified).toBe(true);
    expect(w.s.store.events).toEqual([
      {
        type: 'MemberEmailVerified',
        payload: { memberId: me.member.id, businessId: me.business.id },
      },
    ]);
    expect(w.s.analytics.events.at(-1)).toMatchObject({
      name: 'email_verified',
      properties: { business_id: me.business.id },
    });
    expect((await w.actorOf(sessionToken)).emailVerified).toBe(true);
  });

  test('a used token is 410 and nothing is published again', async () => {
    await w.signUp.execute(signupDetails());
    const token = tokenFromLastEmail();
    await w.verifyEmail.execute({ token });
    expect(await codeOf(w.verifyEmail.execute({ token }))).toBe('TOKEN_EXPIRED');
    expect(w.s.store.events).toHaveLength(1);
  });

  test('an expired (24 h) or unknown token is 410', async () => {
    await w.signUp.execute(signupDetails());
    const token = tokenFromLastEmail();
    w.s.clock.set(new Date(w.s.clock.now().getTime() + 24 * 3_600_000));
    expect(await codeOf(w.verifyEmail.execute({ token }))).toBe('TOKEN_EXPIRED');
    expect(await codeOf(w.verifyEmail.execute({ token: 'nope' }))).toBe('TOKEN_EXPIRED');
    expect(w.s.store.events).toHaveLength(0);
  });

  test('already verified: another valid link answers 200 with no second grant', async () => {
    const { sessionToken } = await w.signUp.execute(signupDetails());
    const first = tokenFromLastEmail();
    w.s.clock.set(new Date(w.s.clock.now().getTime() + 61_000));
    await w.resendVerificationEmail.execute({ actor: await w.actorOf(sessionToken) });
    const second = tokenFromLastEmail();
    await w.verifyEmail.execute({ token: first });
    await expect(w.verifyEmail.execute({ token: second })).resolves.toEqual({ verified: true });
    expect(w.s.store.events).toHaveLength(1);
    expect(w.s.analytics.events.filter((e) => e.name === 'email_verified')).toHaveLength(1);
  });

  test('a resend 30 s after the last email is 429 TOO_MANY_REQUESTS', async () => {
    const { sessionToken } = await w.signUp.execute(signupDetails());
    const actor = await w.actorOf(sessionToken);
    w.s.clock.set(new Date(w.s.clock.now().getTime() + 30_000));
    expect(await codeOf(w.resendVerificationEmail.execute({ actor }))).toBe('TOO_MANY_REQUESTS');
    w.s.clock.set(new Date(w.s.clock.now().getTime() + 30_000));
    expect(await codeOf(w.resendVerificationEmail.execute({ actor }))).toBe('OK');
    expect(w.s.email.sent).toHaveLength(2);
  });

  test('at most 5 resends per day', async () => {
    const { sessionToken } = await w.signUp.execute(signupDetails());
    const actor = await w.actorOf(sessionToken);
    const step = () => w.s.clock.set(new Date(w.s.clock.now().getTime() + 61_000));
    for (let i = 0; i < 5; i += 1) {
      step();
      await w.resendVerificationEmail.execute({ actor });
    }
    step();
    expect(await codeOf(w.resendVerificationEmail.execute({ actor }))).toBe('TOO_MANY_REQUESTS');
    expect(w.s.email.sent).toHaveLength(6);
  });

  test('a verified Member resending gets nothing sent', async () => {
    const { sessionToken } = await w.signUp.execute(signupDetails());
    await w.verifyEmail.execute({ token: tokenFromLastEmail() });
    w.s.clock.set(new Date(w.s.clock.now().getTime() + 61_000));
    await w.resendVerificationEmail.execute({ actor: await w.actorOf(sessionToken) });
    expect(w.s.email.sent).toHaveLength(1);
  });
});
