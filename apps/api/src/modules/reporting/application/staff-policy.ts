import type { Actor } from '../../../shared/domain/actor.js';
import { ForbiddenError } from '../../../shared/domain/errors.js';

/** FR-30, FR-31: the dashboard and customer list are for Staff who passed two-factor (FR-5). */
export function requireStaff(actor: Actor | null | undefined): Actor {
  if (!actor?.roles.includes('staff')) throw new ForbiddenError('Staff only');
  return actor;
}
