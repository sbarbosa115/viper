import type { Actor } from '../../../shared/domain/actor.js';
import { ForbiddenError, UnauthenticatedError } from '../../../shared/domain/errors.js';

/** Back-office use cases need Staff who passed two-factor (the `staff` role), Acting as or not. */
export function requireStaff(actor: Actor | null): Actor {
  if (!actor) throw new UnauthenticatedError('Sign in required');
  if (!actor.roles.includes('staff')) throw new ForbiddenError('Staff only');
  return actor;
}
