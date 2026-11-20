export type Role = 'owner' | 'member' | 'staff';

/** Who is making a request. `actingAs` is set when Staff are Acting as a Business. */
export interface Actor {
  readonly memberId: string;
  readonly businessId: string;
  readonly roles: readonly Role[];
  readonly actingAs?: { readonly businessId: string };
}
