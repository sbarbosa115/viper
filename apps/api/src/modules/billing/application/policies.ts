import type { Actor } from '../../../shared/domain/actor.js';
import { CodedError, ForbiddenError } from '../../../shared/domain/errors.js';

/** Staff endpoints need the `staff` role (granted only after two-factor, FR-5). */
export function requireStaff(actor: Actor): void {
  if (!actor.roles.includes('staff')) throw new ForbiddenError('Staff only');
}

/** FR-12: only a verified Owner buys credits, never Staff Acting as. */
export function requireBuyer(actor: Actor): void {
  if (actor.actingAs) {
    throw new CodedError('ACTING_AS_FORBIDDEN', "Staff can't buy credits while Acting as");
  }
  if (!actor.roles.includes('owner')) throw new ForbiddenError('Only the Owner can buy credits');
  if (!actor.emailVerified) {
    throw new CodedError('EMAIL_NOT_VERIFIED', 'Verify your email to buy credits');
  }
}
