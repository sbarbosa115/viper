import type { Me } from '@app/contracts/identity';
import { UnauthenticatedError } from '../../../shared/domain/errors.js';
import type { Business } from '../domain/business.js';
import type { Member } from '../domain/member.js';
import { Session } from '../domain/session.js';
import type { ActingAsTarget } from '../domain/session-access.js';
import type { IdentityReadRepos, IdentityServices } from './ports.js';

type ReadRepos = IdentityReadRepos;

export interface SignedIn {
  me: Me;
  /** The raw token for the `sid` cookie; only its hash is stored. */
  sessionToken: string;
}

export interface ActiveSession {
  session: Session;
  member: Member;
}

/** The session behind a cookie token, if it exists and has not expired or gone idle. */
export async function findActiveSession(
  services: Pick<IdentityServices, 'repos' | 'tokens' | 'clock'>,
  token: string | undefined,
): Promise<ActiveSession | null> {
  if (!token) return null;
  const session = await services.repos.sessions.findById(services.tokens.hash(token));
  if (!session) return null;
  if (!session.isActive(services.clock.now())) {
    await services.repos.sessions.delete(session.id);
    return null;
  }
  const member = await services.repos.members.findById(session.memberId);
  return member ? { session, member } : null;
}

export async function requireActiveSession(
  services: Pick<IdentityServices, 'repos' | 'tokens' | 'clock'>,
  token: string | undefined,
): Promise<ActiveSession> {
  const active = await findActiveSession(services, token);
  if (!active) throw new UnauthenticatedError('Sign in required');
  return active;
}

/** The Business a Staff session is Acting as, with its Owner; null when not Acting as (FR-6). */
export async function actingAsTarget(
  repos: ReadRepos,
  session: Session,
  member: Member,
): Promise<ActingAsTarget | null> {
  const businessId = session.actingAsBusinessId;
  if (!businessId || !member.isStaff || !session.twoFactorPassed) return null;
  const [business, owner] = await Promise.all([
    repos.businesses.findById(businessId),
    repos.members.findOwnerOf(businessId),
  ]);
  return business && owner ? { business, owner } : null;
}

/**
 * PRD section 7 `Me`. `member` is always the person signed in; `business` is the Business the
 * app shows: the Member's own or, while Acting as, the target (with `actingAs` set).
 */
export async function buildMe(repos: ReadRepos, session: Session, member: Member): Promise<Me> {
  const target = await actingAsTarget(repos, session, member);
  const business: Business | null = target
    ? target.business
    : await repos.businesses.findById(member.businessId);
  if (!business) throw new UnauthenticatedError('Sign in required');
  return {
    member: {
      id: member.id,
      name: member.name,
      email: member.email,
      emailVerified: member.emailVerified,
      isStaff: member.isStaff,
    },
    business: { id: business.id, name: business.name },
    actingAs: target
      ? { businessId: target.business.id, businessName: target.business.name }
      : null,
    twoFactor: {
      required: member.isStaff,
      passed: session.twoFactorPassed,
      setUp: member.twoFactorSetUp,
    },
  };
}

/** Starts a fresh session (FR-1, FR-3, FR-4); Staff still need the two-factor step. */
export function newSession(
  services: Pick<IdentityServices, 'tokens' | 'clock'>,
  memberId: string,
): { session: Session; sessionToken: string } {
  const sessionToken = services.tokens.generate();
  const session = Session.start({
    id: services.tokens.hash(sessionToken),
    memberId,
    now: services.clock.now(),
  });
  return { session, sessionToken };
}
