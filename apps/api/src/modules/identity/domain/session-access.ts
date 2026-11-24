import type { Actor, Role } from '../../../shared/domain/actor.js';
import type { Business } from './business.js';
import type { Member } from './member.js';
import type { Session } from './session.js';

/**
 * What a session may do (ADR 0004, ADR 0014):
 * - `half`: a Staff Member after the password step; only the two-factor endpoints work (FR-5).
 * - `full`: an Actor for the Member's own Business or, for Staff Acting as, the target Business
 *   as its Owner would see it, with `actingAs` set (FR-6).
 */
export type SessionAccess = { kind: 'half' } | { kind: 'full'; actor: Actor };

export interface ActingAsTarget {
  business: Business;
  owner: Member;
}

export function isHalfSession(session: Session, member: Member): boolean {
  return member.isStaff && !session.twoFactorPassed;
}

export function sessionAccess(input: {
  session: Session;
  member: Member;
  actingAs: ActingAsTarget | null;
}): SessionAccess {
  const { session, member, actingAs } = input;
  if (isHalfSession(session, member)) return { kind: 'half' };

  // A Member's own role for their Business (prd-support v0.3); Staff keep `owner` for Acting as.
  const base: Role = member.role === 'member' && !member.isStaff ? 'member' : 'owner';
  const roles: Role[] = member.isStaff ? [base, 'staff'] : [base];
  if (member.isStaff && actingAs) {
    return {
      kind: 'full',
      actor: {
        memberId: member.id,
        businessId: actingAs.business.id,
        roles,
        emailVerified: actingAs.owner.emailVerified,
        actingAs: {
          businessId: actingAs.business.id,
          businessName: actingAs.business.name,
          staffMemberId: member.id,
        },
      },
    };
  }
  return {
    kind: 'full',
    actor: {
      memberId: member.id,
      businessId: member.businessId,
      roles,
      emailVerified: member.emailVerified,
    },
  };
}
