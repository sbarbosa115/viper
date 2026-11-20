import type { Actor } from '../../../shared/domain/actor.js';
import { CodedError, ForbiddenError } from '../../../shared/domain/errors.js';
import type { ProfileView } from './ports.js';

/**
 * Plans belong to the Actor's Business (the target while Acting as). Owners, verified or not,
 * create and edit them (PRD section 4); every read and write is scoped to `actor.businessId`.
 */
export function assertCanPlan(actor: Actor): void {
  if (!actor.roles.includes('owner')) throw new ForbiddenError('Only the Owner can manage Plans');
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
