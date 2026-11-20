export type Role = 'owner' | 'member' | 'staff';

/**
 * Who is making a request (ADR 0004, ADR 0014). Resolved by the identity module from the session.
 * - `memberId` is always the person signed in (the Staff member while Acting as).
 * - `businessId` is the Business being acted on: the Member's own, or the target while Acting as.
 * - `roles` holds `owner` for that Business, plus `staff` only for Staff whose session passed
 *   two-factor (FR-5). Use cases check roles; routes only require a signed-in actor.
 * - `emailVerified` is the Business Owner's verification (gates runs and purchases, FR-2).
 */
export interface Actor {
  readonly memberId: string;
  readonly businessId: string;
  readonly roles: readonly Role[];
  readonly emailVerified: boolean;
  readonly actingAs?: {
    readonly businessId: string;
    readonly businessName: string;
    readonly staffMemberId: string;
  };
}
