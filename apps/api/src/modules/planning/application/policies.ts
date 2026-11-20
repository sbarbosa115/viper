import type { Actor } from '../../../shared/domain/actor.js';
import { CodedError, ForbiddenError } from '../../../shared/domain/errors.js';
import type { ProfileView } from './ports.js';

/**
 * Plans belong to the Actor's Business (the target while Acting as); every read and write is
 * scoped to `actor.businessId`. Owners, verified or not, edit them (PRD section 4).
 */
export function assertCanPlan(actor: Actor): void {
  if (!actor.roles.includes('owner')) throw new ForbiddenError('Only the Owner can manage Plans');
}

/**
 * Creating a Plan calls the planning model (it costs money), so it needs a verified email, like
 * starting research (FR-18) and buying credits.
 */
export function assertVerified(actor: Actor): void {
  if (!actor.emailVerified) {
    throw new CodedError('EMAIL_NOT_VERIFIED', 'Verify your email to create a Plan');
  }
}

/** Plans a Business may create per UTC day (each one is a planning-model call). */
export const DAILY_PLAN_LIMIT = 30;

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Same code, message style and details as the chat's daily limit. */
export function dailyPlanLimitReached(limit: number): CodedError {
  return new CodedError(
    'TOO_MANY_REQUESTS',
    "That's enough new Plans for today. Let's continue tomorrow.",
    { limit },
  );
}

export function profileIncomplete(): CodedError {
  return new CodedError(
    'PROFILE_INCOMPLETE',
    'Finish your Business Profile first: Products, location and delivery radius',
  );
}

/** A profile a Plan can be drafted from: complete, located, with at least one Product. */
export function usableProfile(
  profile: ProfileView | null,
): (ProfileView & { location: NonNullable<ProfileView['location']> }) | null {
  if (!profile?.complete || !profile.location || profile.products.length === 0) return null;
  return { ...profile, location: profile.location };
}
