import { ValidationError } from '../../../shared/domain/errors.js';

/** Common passwords of 10+ characters (auth.md: reject the most common passwords). */
const COMMON = new Set([
  '1234567890',
  '0123456789',
  '12345678910',
  '123456789a',
  'qwertyuiop',
  'password12',
  'password123',
  'password1234',
  'passw0rd123',
  '1q2w3e4r5t',
  'qwerty1234',
  'qwerty12345',
  'iloveyou12',
  'abcdefghij',
  'aaaaaaaaaa',
  '1111111111',
  'letmein123',
  'welcome123',
  'abc1234567',
  'football12',
]);

/**
 * A new password: 10 to 128 characters and not a common one (FR-1, FR-4).
 * `field` names the request field in the 400 response.
 */
export function assertNewPassword(plain: string, field = 'password'): void {
  if (plain.length < 10 || plain.length > 128) {
    throw new ValidationError('Password must be 10 to 128 characters', {
      [field]: 'Must be 10 to 128 characters',
    });
  }
  if (COMMON.has(plain.toLowerCase())) {
    throw new ValidationError('Password is too common', {
      [field]: 'This password is too common; choose another',
    });
  }
}
