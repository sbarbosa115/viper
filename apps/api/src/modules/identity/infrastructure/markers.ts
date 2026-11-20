/**
 * Sign-ups are counted per IP in `login_attempts` (FR-1) under this marker instead of an email.
 * It has no `@`, so it never matches a real login.
 */
export const SIGNUP_MARKER = '#signup';

/**
 * Staff two-factor codes are counted per Member in `login_attempts` (FR-5) under this prefix and
 * the Member id. No `@` either.
 */
export const TWO_FACTOR_MARKER_PREFIX = '#2fa:';

export function twoFactorMarker(memberId: string): string {
  return `${TWO_FACTOR_MARKER_PREFIX}${memberId}`;
}
