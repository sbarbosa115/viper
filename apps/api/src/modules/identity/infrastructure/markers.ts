/**
 * Sign-ups are counted per IP in `login_attempts` (FR-1) under this marker instead of an email.
 * It has no `@`, so it never matches a real login.
 */
export const SIGNUP_MARKER = '#signup';
