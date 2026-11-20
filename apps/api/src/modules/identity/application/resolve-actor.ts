import type { Actor } from '../../../shared/domain/actor.js';
import { identityErrors } from '../domain/errors.js';
import { sessionAccess } from '../domain/session-access.js';
import type { IdentityServices } from './ports.js';
import { actingAsTarget, findActiveSession } from './session-context.js';

/**
 * Session cookie → Actor, on every request (ADR 0004, ADR 0014). Slides the session (written at
 * most once an hour) and the Business's last activity. A Staff half-session has no Actor: back-
 * office paths answer 403 TWO_FACTOR_REQUIRED, everything else 401 (FR-5).
 */
export class ResolveActor {
  constructor(private readonly s: Pick<IdentityServices, 'repos' | 'tokens' | 'clock'>) {}

  async execute(cmd: { token: string | undefined; path: string }): Promise<Actor | null> {
    const active = await findActiveSession(this.s, cmd.token);
    if (!active) return null;
    const { session, member } = active;
    const now = this.s.clock.now();
    if (session.touch(now)) {
      await this.s.repos.sessions.save(session);
      await this.s.repos.businesses.touchActivity(member.businessId, now);
    }
    const access = sessionAccess({
      session,
      member,
      actingAs: await actingAsTarget(this.s.repos, session, member),
    });
    if (access.kind === 'half') {
      if (isBackOfficePath(cmd.path)) throw identityErrors.twoFactorRequired();
      return null;
    }
    return access.actor;
  }
}

export function isBackOfficePath(path: string): boolean {
  return path === '/api/staff' || path.startsWith('/api/staff/') || path.startsWith('/api/staff?');
}
