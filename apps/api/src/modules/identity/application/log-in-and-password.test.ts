import { beforeEach, describe, expect, test } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors.js';
import { identityWorld, PASSWORD, signupDetails } from '../test/factories.js';

let w: ReturnType<typeof identityWorld>;
beforeEach(() => {
  w = identityWorld();
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return (e as { code?: string }).code ?? 'UNKNOWN';
  }
}

const later = (ms: number) => w.s.clock.set(new Date(w.s.clock.now().getTime() + ms));

describe('FR-3: log in and log out', () => {
  test('correct Owner credentials start a session; me returns the Member and Business', async () => {
    const details = signupDetails();
    const signedUp = await w.signUp.execute(details);
    const { me, sessionToken } = await w.logIn.execute({
      email: details.email.toUpperCase(),
      password: PASSWORD,
      ip: '1.1.1.1',
    });
    expect(sessionToken).not.toBe(signedUp.sessionToken);
    expect(me).toEqual(signedUp.me);
    expect(await w.getMe.execute({ token: sessionToken })).toEqual(me);
  });

  test('a wrong password and an unknown email give the same 401 INVALID_CREDENTIALS', async () => {
    const details = signupDetails();
    await w.signUp.execute(details);
    const failure = (p: Promise<unknown>) =>
      p.then(
        () => ({ code: 'OK', message: '' }),
        (e: unknown) => ({ code: (e as { code: string }).code, message: (e as Error).message }),
      );
    const wrong = await failure(
      w.logIn.execute({ email: details.email, password: 'wrong password!', ip: '1.1.1.1' }),
    );
    const unknown = await failure(
      w.logIn.execute({ email: 'nobody@example.com', password: PASSWORD, ip: '1.1.1.1' }),
    );
    expect(wrong).toEqual(unknown);
    expect(wrong.code).toBe('INVALID_CREDENTIALS');
  });

  test('after 5 wrong passwords the 6th try is 429 even when correct, for 15 minutes', async () => {
    const details = signupDetails();
    await w.signUp.execute(details);
    for (let i = 0; i < 5; i += 1) {
      const attempt = w.logIn.execute({
        email: details.email,
        password: 'wrong password!',
        ip: `9.9.9.${i}`,
      });
      expect(await codeOf(attempt)).toBe('INVALID_CREDENTIALS');
    }
    const correct = () =>
      w.logIn.execute({ email: details.email, password: PASSWORD, ip: '8.8.8.8' });
    expect(await codeOf(correct())).toBe('TOO_MANY_REQUESTS');
    later(15 * 60_000 + 1);
    expect(await codeOf(correct())).toBe('OK');
  });

  test('20 failures from one IP in 15 minutes block that IP', async () => {
    for (let i = 0; i < 20; i += 1) {
      await codeOf(
        w.logIn.execute({ email: `x${i}@example.com`, password: 'wrong password!', ip: '7.7.7.7' }),
      );
    }
    const details = signupDetails();
    await w.signUp.execute(details);
    expect(
      await codeOf(w.logIn.execute({ email: details.email, password: PASSWORD, ip: '7.7.7.7' })),
    ).toBe('TOO_MANY_REQUESTS');
    expect(
      await codeOf(w.logIn.execute({ email: details.email, password: PASSWORD, ip: '6.6.6.6' })),
    ).toBe('OK');
  });

  test('logging out deletes the session: me is 401 and the actor is gone', async () => {
    const { sessionToken } = await w.signUp.execute(signupDetails());
    await w.logOut.execute({ token: sessionToken });
    expect(await codeOf(w.getMe.execute({ token: sessionToken }))).toBe('UNAUTHENTICATED');
    expect(await w.resolveActor.execute({ token: sessionToken, path: '/api/plans' })).toBeNull();
  });

  test('a session idle for 14 days or past 30 days without use is gone', async () => {
    const { sessionToken } = await w.signUp.execute(signupDetails());
    later(13 * 24 * 3_600_000);
    expect(await w.resolveActor.execute({ token: sessionToken, path: '/' })).not.toBeNull();
    later(13 * 24 * 3_600_000);
    // Used on day 13, so it slid: still valid on day 26.
    expect(await w.resolveActor.execute({ token: sessionToken, path: '/' })).not.toBeNull();
    later(14 * 24 * 3_600_000);
    expect(await w.resolveActor.execute({ token: sessionToken, path: '/' })).toBeNull();
  });

  test('using a session marks the Business active (at most once an hour)', async () => {
    const { sessionToken, me } = await w.signUp.execute(signupDetails());
    later(2 * 3_600_000);
    await w.resolveActor.execute({ token: sessionToken, path: '/' });
    expect(w.s.store.businesses.get(me.business.id)?.lastActiveAt).toEqual(w.s.clock.now());
  });
});

describe('FR-4: password reset', () => {
  function resetTokenFromLastEmail(): string {
    const text = w.s.email.sent.at(-1)?.text ?? '';
    const match = /reset-password\?token=([^\s&]+)/.exec(text);
    if (!match?.[1]) throw new Error('no reset link');
    return decodeURIComponent(match[1]);
  }

  test('an unknown email: accepted, no email sent', async () => {
    await expect(w.requestPasswordReset.execute({ email: 'ghost@example.com' })).resolves.toBe(
      undefined,
    );
    expect(w.s.email.sent).toHaveLength(0);
  });

  test('a valid token sets the new password, old sessions stop working, the new password logs in', async () => {
    const details = signupDetails();
    const { sessionToken: old } = await w.signUp.execute(details);
    await w.requestPasswordReset.execute({ email: details.email });
    const mail = w.s.email.sent.at(-1);
    expect(mail?.subject).toContain('Reset your Llyner Leads password');
    expect(mail?.text).toContain('http://localhost:5173/app/reset-password?token=');

    const signedIn = await w.confirmPasswordReset.execute({
      token: resetTokenFromLastEmail(),
      password: 'a brand new password',
    });
    expect(await w.resolveActor.execute({ token: old, path: '/' })).toBeNull();
    expect(
      await w.resolveActor.execute({ token: signedIn.sessionToken, path: '/' }),
    ).not.toBeNull();
    expect(
      await codeOf(
        w.logIn.execute({ email: details.email, password: 'a brand new password', ip: '1.2.3.4' }),
      ),
    ).toBe('OK');
    expect(
      await codeOf(w.logIn.execute({ email: details.email, password: PASSWORD, ip: '1.2.3.4' })),
    ).toBe('INVALID_CREDENTIALS');
  });

  test('a used or expired (1 h) token is 410 TOKEN_EXPIRED', async () => {
    const details = signupDetails();
    await w.signUp.execute(details);
    await w.requestPasswordReset.execute({ email: details.email });
    const token = resetTokenFromLastEmail();
    await w.confirmPasswordReset.execute({ token, password: 'a brand new password' });
    expect(
      await codeOf(w.confirmPasswordReset.execute({ token, password: 'another new password' })),
    ).toBe('TOKEN_EXPIRED');

    later(60_000);
    await w.requestPasswordReset.execute({ email: details.email });
    const second = resetTokenFromLastEmail();
    later(3_600_000);
    expect(
      await codeOf(
        w.confirmPasswordReset.execute({ token: second, password: 'another new password' }),
      ),
    ).toBe('TOKEN_EXPIRED');
  });

  test('a verification token cannot reset a password', async () => {
    await w.signUp.execute(signupDetails());
    const verifyToken = /token=([^\s&]+)/.exec(w.s.email.sent[0]?.text ?? '')?.[1] ?? '';
    expect(
      await codeOf(
        w.confirmPasswordReset.execute({ token: verifyToken, password: 'a brand new password' }),
      ),
    ).toBe('TOKEN_EXPIRED');
  });

  test('the new password must be 10 to 128 characters', async () => {
    await expect(
      w.confirmPasswordReset.execute({ token: 'whatever', password: 'short' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('at most 3 reset emails per email per hour (silently, still accepted)', async () => {
    const details = signupDetails();
    await w.signUp.execute(details);
    for (let i = 0; i < 4; i += 1) await w.requestPasswordReset.execute({ email: details.email });
    expect(w.s.email.sent.filter((m) => m.subject.includes('Reset'))).toHaveLength(3);
  });

  test('signed-in change: wrong current password is 401; success keeps this session only', async () => {
    const details = signupDetails();
    const { sessionToken } = await w.signUp.execute(details);
    const other = await w.logIn.execute({ ...details, ip: '1.1.1.1' });
    const actor = await w.actorOf(sessionToken);

    expect(
      await codeOf(
        w.changePassword.execute({
          actor,
          sessionToken,
          currentPassword: 'not it at all',
          newPassword: 'a brand new password',
        }),
      ),
    ).toBe('INVALID_CREDENTIALS');
    await w.changePassword.execute({
      actor,
      sessionToken,
      currentPassword: PASSWORD,
      newPassword: 'a brand new password',
    });
    expect(await w.resolveActor.execute({ token: sessionToken, path: '/' })).not.toBeNull();
    expect(await w.resolveActor.execute({ token: other.sessionToken, path: '/' })).toBeNull();
  });

  test('signed-in change validates the new password, naming newPassword', async () => {
    const { sessionToken } = await w.signUp.execute(signupDetails());
    const err = await w.changePassword
      .execute({
        actor: await w.actorOf(sessionToken),
        sessionToken,
        currentPassword: PASSWORD,
        newPassword: 'short',
      })
      .catch((e: unknown) => e);
    expect((err as ValidationError).details).toHaveProperty('newPassword');
  });
});
