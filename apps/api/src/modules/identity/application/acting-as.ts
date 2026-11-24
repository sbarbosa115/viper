import type { Me } from '@app/contracts/identity';
import type { Actor } from '../../../shared/domain/actor.js';
import { ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import type { IdentityServices } from './ports.js';
import { buildMe, requireActiveSession } from './session-context.js';

/** Back-office endpoints need Staff whose session passed two-factor (FR-5). */
export function assertStaff(actor: Actor | null): asserts actor is Actor {
  if (!actor?.roles.includes('staff')) throw new ForbiddenError('Staff only');
}

function auditEntry(staffMemberId: string, businessId: string, action: string, details = {}) {
  return {
    staffMemberId,
    businessId,
    action,
    targetType: 'business',
    targetId: businessId,
    details,
  };
}

/**
 * FR-6: Staff use a Business as its Owner would. Only one at a time: starting another replaces
 * the first (Audit log: stopped, then started).
 */
export class StartActingAs {
  constructor(private readonly s: IdentityServices) {}

  async execute(cmd: {
    actor: Actor | null;
    token: string | undefined;
    businessId: string;
    /** When started from a support Ticket: stored in the Audit log entry. */
    ticketNumber?: number | undefined;
  }): Promise<Me> {
    assertStaff(cmd.actor);
    const { session, member } = await requireActiveSession(this.s, cmd.token);
    const [business, owner] = await Promise.all([
      this.s.repos.businesses.findById(cmd.businessId),
      this.s.repos.members.findOwnerOf(cmd.businessId),
    ]);
    if (!business || !owner) {
      throw new NotFoundError('Business not found', { businessId: cmd.businessId });
    }
    const previous = session.actingAsBusinessId;
    if (previous === business.id) return buildMe(this.s.repos, session, member);

    session.actAs(business.id);
    await this.s.uow.run((r) => r.sessions.save(session));
    if (previous) {
      await this.s.audit.record(
        auditEntry(member.id, previous, 'acting_as.stopped', { reason: 'replaced' }),
      );
    }
    await this.s.audit.record(
      auditEntry(
        member.id,
        business.id,
        'acting_as.started',
        cmd.ticketNumber === undefined ? {} : { ticketNumber: cmd.ticketNumber },
      ),
    );
    await this.s.analytics.track({
      name: 'acting_as_started',
      actor: { memberId: member.id, businessId: business.id },
      properties: { staff_member_id: member.id, business_id: business.id },
    });
    return buildMe(this.s.repos, session, member);
  }
}

/** FR-6: "Stop acting as": Staff see their own Business again. */
export class StopActingAs {
  constructor(private readonly s: IdentityServices) {}

  async execute(cmd: { actor: Actor | null; token: string | undefined }): Promise<Me> {
    assertStaff(cmd.actor);
    const { session, member } = await requireActiveSession(this.s, cmd.token);
    const previous = session.actingAsBusinessId;
    if (previous) {
      session.stopActingAs();
      await this.s.uow.run((r) => r.sessions.save(session));
      await this.s.audit.record(auditEntry(member.id, previous, 'acting_as.stopped'));
    }
    return buildMe(this.s.repos, session, member);
  }
}
