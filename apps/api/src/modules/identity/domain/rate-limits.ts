import { identityErrors } from './errors.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The rate limits of FR-1 to FR-5, counted in the database (stateless processes). */
export const rateLimits = {
  /** FR-1: 5 sign-ups per IP per hour. */
  signupsPerIp: { max: 5, windowMs: HOUR },
  /** FR-3: 5 failed logins per email or 20 per IP in 15 min → 429 for 15 min. */
  loginFailuresPerEmail: { max: 5, windowMs: 15 * MINUTE },
  loginFailuresPerIp: { max: 20, windowMs: 15 * MINUTE },
  /** FR-2: resend at most once per 60 s and 5 per day. */
  verificationResendGapMs: MINUTE,
  verificationResendsPerDay: { max: 5, windowMs: 24 * HOUR },
  /** FR-4: 3 reset requests per email per hour. */
  resetRequestsPerEmail: { max: 3, windowMs: HOUR },
} as const;

export function windowStart(now: Date, windowMs: number): Date {
  return new Date(now.getTime() - windowMs);
}

/** Throws 429 TOO_MANY_REQUESTS once `count` reached `max`. */
export function assertUnderLimit(count: number, limit: { max: number; windowMs: number }): void {
  if (count >= limit.max) throw identityErrors.tooManyRequests(Math.ceil(limit.windowMs / 1000));
}

/** FR-2: the previous verification email was sent less than 60 s ago → 429. */
export function assertResendGap(lastSentAt: Date | null, now: Date): void {
  if (!lastSentAt) return;
  const waited = now.getTime() - lastSentAt.getTime();
  if (waited < rateLimits.verificationResendGapMs) {
    throw identityErrors.tooManyRequests(
      Math.ceil((rateLimits.verificationResendGapMs - waited) / 1000),
    );
  }
}
