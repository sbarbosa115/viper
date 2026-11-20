import { describe, expect, test } from 'vitest';
import * as ex from './examples.js';
import {
  changePassword,
  confirmPasswordReset,
  login,
  me,
  signup,
  startActingAs,
  twoFactorSetup,
  twoFactorVerify,
  verifyEmail,
} from './identity.js';

describe('contracts: identity', () => {
  test('FR-1: sign-up body lowercases the email and enforces the limits', () => {
    const body = signup.body.parse({
      businessName: 'Sweet Supply Co',
      name: 'Sam',
      email: ' Owner@Demo.TEST ',
      password: '0123456789',
    });
    expect(body.email).toBe('owner@demo.test');
    const short = signup.body.safeParse({ ...body, password: '012345678' });
    expect(short.error?.issues[0]?.path).toEqual(['password']);
    expect(signup.body.safeParse({ ...body, businessName: 'S' }).success).toBe(false);
    expect(signup.errors).toContainEqual({ status: 409, code: 'EMAIL_TAKEN' });
  });

  test('Me: valid example parses; Acting as needs a business id', () => {
    expect(me.parse(ex.me)).toEqual(ex.me);
    expect(
      me.safeParse({ ...ex.me, actingAs: { businessId: 'nope', businessName: 'B' } }).success,
    ).toBe(false);
  });

  test('FR-2: verify email takes a token and returns verified: true', () => {
    expect(verifyEmail.body.safeParse({ token: 'abc' }).success).toBe(true);
    expect(verifyEmail.body.safeParse({ token: '' }).success).toBe(false);
    expect(verifyEmail.response.safeParse({ verified: false }).success).toBe(false);
  });

  test('FR-3: login', () => {
    expect(login.body.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(login.body.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
  });

  test('FR-5: two-factor setup and verify', () => {
    const setup = {
      otpauthUrl: 'otpauth://totp/Llyner',
      secret: 'JBSWY3DPEHPK3PXP',
      qrSvg: '<svg/>',
    };
    expect(twoFactorSetup.response.safeParse(setup).success).toBe(true);
    expect(twoFactorSetup.response.safeParse({ ...setup, otpauthUrl: 'https://x' }).success).toBe(
      false,
    );
    expect(twoFactorVerify.body.safeParse({ code: '123456' }).success).toBe(true);
    expect(twoFactorVerify.body.safeParse({ code: '12345a' }).success).toBe(false);
    expect(twoFactorVerify.auth).toBe('halfSession');
  });

  test('FR-4: password reset confirm and change', () => {
    expect(
      confirmPasswordReset.body.safeParse({ token: 't', password: '0123456789' }).success,
    ).toBe(true);
    expect(confirmPasswordReset.body.safeParse({ token: 't', password: 'short' }).success).toBe(
      false,
    );
    expect(
      changePassword.body.safeParse({ currentPassword: 'old', newPassword: '0123456789' }).success,
    ).toBe(true);
    expect(changePassword.body.safeParse({ currentPassword: 'old' }).success).toBe(false);
    expect(changePassword.errors).toContainEqual({ status: 403, code: 'ACTING_AS_FORBIDDEN' });
  });

  test('FR-6: start Acting as needs a business id', () => {
    expect(startActingAs.body.safeParse({ businessId: ex.ids.business }).success).toBe(true);
    expect(startActingAs.body.safeParse({ businessId: 42 }).success).toBe(false);
  });
});
