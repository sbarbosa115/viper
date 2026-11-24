import type { StaffTicketDetail, Status } from '@app/contracts/support';
import { CodedError, ForbiddenError } from '../../../../shared/domain/errors.js';
import type { Actor } from '../../../../shared/domain/actor.js';
import {
  addNote,
  assertVersion,
  assign,
  isFirstViewOfDay,
  isVersionConflict,
  markReadByAssignee,
  minutesBetween,
  outboxEvents,
  setStatus,
  staffReply,
  statsSince,
  supportErrors,
  supportStats,
  take,
  type StaffListQuery,
  type SupportTx,
  type Ticket,
  type TicketChange,
  type TicketContext,
  type TicketFact,
} from '../../domain/index.js';
import type { SupportAuditAction } from '../../ports.js';
import type { StaffSupportDeps } from './deps.js';
import { detailOf, summariesOf } from './views.js';

const DAY_MS = 24 * 3600 * 1000;

/** Every Support desk endpoint is for Staff who passed two-factor; Acting as is ignored (FR-12). */
export function requireStaff(actor: Actor | null | undefined): Actor {
  if (!actor?.roles.includes('staff')) throw new ForbiddenError('Staff only');
  return actor;
}

export interface ListTicketsInput {
  view: 'waiting' | 'mine' | 'waiting_on_customer' | 'closed' | 'all';
  category?: StaffListQuery['category'];
  /** `me`, `nobody` or a Staff Member's id. */
  assignee?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

/** The Staff action being audited: each writes at most one Audit log entry. */
interface AuditPlan {
  kind: 'take' | 'assign' | 'status' | 'reply' | 'note';
  then?: 'wait_on_customer' | 'close' | undefined;
}

export function createStaffSupport(deps: StaffSupportDeps) {
  const { store, identity, audit, analytics, clock, ids } = deps;
  const ctx = (): TicketContext => ({ now: clock.now(), ids });

  async function findOrThrow(number: number): Promise<Ticket> {
    const ticket = await store.read.findByNumber(number);
    if (!ticket) throw supportErrors.ticketNotFound();
    return ticket;
  }

  async function lockedOrThrow(tx: SupportTx, number: number): Promise<Ticket> {
    const ticket = await tx.tickets.findByNumber(number, { forUpdate: true });
    if (!ticket) throw supportErrors.ticketNotFound();
    return ticket;
  }

  async function currentOrThrow(tx: SupportTx, number: number, version: number): Promise<Ticket> {
    const ticket = await tx.tickets.findByNumber(number);
    if (!ticket) throw supportErrors.ticketNotFound();
    assertVersion(ticket, version);
    return ticket;
  }

  /** Saves a change with its outbox events and one Audit log entry per Staff action. */
  async function commit(
    tx: SupportTx,
    staff: Actor,
    before: Ticket,
    change: TicketChange,
    plan: AuditPlan,
  ) {
    await tx.tickets.saveChange(change);
    for (const e of outboxEvents(change.ticket, change.events)) {
      await tx.events.publish(e.type, e.payload);
    }
    const entry = auditEntry(before, change.facts, plan);
    if (entry) {
      await audit.record(
        {
          staffMemberId: staff.memberId,
          businessId: change.ticket.businessId,
          action: entry.action,
          targetType: 'support_ticket',
          targetId: change.ticket.id,
          details: { ticketNumber: change.ticket.number, ...entry.details },
        },
        tx.handle,
      );
    }
  }

  /** Analytics for a committed change (outside the transaction: it may have been retried). */
  async function track(
    staff: Actor,
    before: Ticket,
    change: TicketChange,
    counts: { staffReplies: number; customerReplies: number },
  ): Promise<void> {
    const actor = { memberId: staff.memberId, businessId: before.businessId };
    const base = { ticket_number: before.number };
    const now = change.ticket.updatedAt;
    for (const fact of change.facts) {
      const event = analyticsFor(fact, { before, change, counts, base, now });
      if (event) await analytics.track({ ...event, actor });
    }
  }

  async function conflictOrRethrow(error: unknown, number: number): Promise<never> {
    if (!isVersionConflict(error)) throw error;
    const current = await findOrThrow(number);
    throw new CodedError(
      error.code,
      error.message,
      { ticket: await detailOf(deps, store, current) },
      409,
    );
  }

  /** Runs a versioned command: read, check the version, command, save; a stale save → 409 with the ticket. */
  async function versioned(
    staff: Actor,
    number: number,
    version: number,
    command: (ticket: Ticket, c: TicketContext) => TicketChange,
    plan: AuditPlan,
  ): Promise<StaffTicketDetail> {
    try {
      const done = await store.run(async (tx) => {
        const before = await currentOrThrow(tx, number, version);
        const c = ctx();
        const change = command(before, c);
        await commit(tx, staff, before, change, plan);
        return { before, change, counts: await replyCounts(tx, change) };
      });
      await track(staff, done.before, done.change, done.counts);
    } catch (error) {
      return conflictOrRethrow(error, number);
    }
    return detailOf(deps, store, await findOrThrow(number));
  }

  async function replyCounts(tx: SupportTx, change: TicketChange) {
    if (!change.facts.some((f) => f.type === 'closed'))
      return { staffReplies: 0, customerReplies: 0 };
    const all = await tx.tickets.messages(change.ticket.id);
    return {
      staffReplies: all.filter((m) => m.kind === 'staff_reply').length,
      customerReplies: all.filter((m) => m.kind === 'customer_reply').length,
    };
  }

  /** An unversioned command (reply, note): the row is locked, so the save never conflicts. */
  async function locked(
    staff: Actor,
    number: number,
    command: (ticket: Ticket, c: TicketContext) => TicketChange,
    plan: AuditPlan,
  ): Promise<StaffTicketDetail> {
    const done = await store.run(async (tx) => {
      const before = await lockedOrThrow(tx, number);
      const change = command(before, ctx());
      await commit(tx, staff, before, change, plan);
      return { before, change, counts: await replyCounts(tx, change) };
    });
    await track(staff, done.before, done.change, done.counts);
    return detailOf(deps, store, await findOrThrow(number));
  }

  return {
    /** FR-6: one view of the Support desk, the chips' counts and the stats strip. */
    async listTickets(caller: Actor, input: ListTicketsInput) {
      const staff = requireStaff(caller);
      const now = clock.now();
      const assignee =
        input.assignee === undefined
          ? undefined
          : input.assignee === 'me'
            ? staff.memberId
            : input.assignee === 'nobody'
              ? null
              : input.assignee;
      const [page, counts, waiting, recent] = await Promise.all([
        store.read.listForStaff({
          view: input.view,
          staffId: staff.memberId,
          category: input.category,
          assigneeId: assignee,
          cursor: input.cursor ?? null,
          limit: input.limit,
        }),
        store.read.staffCounts(staff.memberId),
        store.read.waitingSummary(),
        store.read.ticketTimesSince(statsSince(now)),
      ]);
      const items = await summariesOf(deps, page.items, now);
      await analytics.track({
        name: 'support_desk_viewed',
        actor: { memberId: staff.memberId, businessId: null },
        properties: { view: input.view, waiting_count: counts.waiting },
      });
      return {
        items,
        counts,
        stats: supportStats({ waiting, recent, now }),
        nextCursor: page.nextCursor,
      };
    },

    /** FR-6: the nav badge. */
    async waitingCount(caller: Actor): Promise<{ waiting: number }> {
      requireStaff(caller);
      return { waiting: (await store.read.waitingSummary()).count };
    },

    /** FR-8: the assignee picker. */
    async listStaff(caller: Actor) {
      requireStaff(caller);
      const staff = await identity.staffMembers();
      return { items: staff.map(({ id, name, email }) => ({ id, name, email })) };
    },

    /**
     * FR-7: the whole Ticket. The assignee viewing reads the customer replies; the first view per
     * Staff Member, Ticket and Chicago day is audited (`support.ticket_viewed`).
     */
    async getTicket(caller: Actor, number: number): Promise<StaffTicketDetail> {
      const staff = requireStaff(caller);
      await findOrThrow(number);
      await store.run(async (tx) => {
        const ticket = await lockedOrThrow(tx, number);
        const c = ctx();
        await tx.tickets.saveChange(markReadByAssignee(ticket, { staffId: staff.memberId }, c));
        const { previousViewAt } = await tx.tickets.recordView(ticket.id, staff.memberId, c.now);
        if (isFirstViewOfDay(previousViewAt, c.now)) {
          await audit.record(
            {
              staffMemberId: staff.memberId,
              businessId: ticket.businessId,
              action: 'support.ticket_viewed',
              targetType: 'support_ticket',
              targetId: ticket.id,
              details: { ticketNumber: ticket.number },
            },
            tx.handle,
          );
        }
      });
      return detailOf(deps, store, await findOrThrow(number));
    },

    /** FR-8: assignee = me; the taker is looking at it, so its customer replies count as read. */
    take(caller: Actor, number: number, version: number): Promise<StaffTicketDetail> {
      const staff = requireStaff(caller);
      return versioned(
        staff,
        number,
        version,
        (ticket, c) => takeAndRead(ticket, staff.memberId, c),
        { kind: 'take' },
      );
    },

    /** FR-8: any Staff Member or nobody (UNKNOWN_STAFF otherwise). */
    async assign(
      caller: Actor,
      number: number,
      input: { version: number; assigneeId: string | null },
    ): Promise<StaffTicketDetail> {
      const staff = requireStaff(caller);
      await findOrThrow(number);
      if (input.assigneeId !== null) {
        const members = await identity.staffMembers();
        if (!members.some((m) => m.id === input.assigneeId)) throw supportErrors.unknownStaff();
      }
      return versioned(
        staff,
        number,
        input.version,
        (ticket, c) => assign(ticket, { staffId: staff.memberId, assigneeId: input.assigneeId }, c),
        { kind: 'assign' },
      );
    },

    /** FR-9: any of the four statuses; `closed` closes, another status on a closed Ticket reopens it. */
    setStatus(
      caller: Actor,
      number: number,
      input: { version: number; status: Status },
    ): Promise<StaffTicketDetail> {
      const staff = requireStaff(caller);
      return versioned(
        staff,
        number,
        input.version,
        (ticket, c) => setStatus(ticket, { staffId: staff.memberId, status: input.status }, c),
        { kind: 'status' },
      );
    },

    /** FR-9: reply, optionally then wait on the customer or close (one email for both). */
    reply(
      caller: Actor,
      number: number,
      input: { message: string; then?: 'wait_on_customer' | 'close' | undefined },
    ): Promise<StaffTicketDetail> {
      const staff = requireStaff(caller);
      return locked(
        staff,
        number,
        (ticket, c) =>
          staffReply(ticket, { staffId: staff.memberId, text: input.message, then: input.then }, c),
        { kind: 'reply', then: input.then },
      );
    },

    /** FR-10: an Internal note, Staff only. */
    addNote(caller: Actor, number: number, note: string): Promise<StaffTicketDetail> {
      const staff = requireStaff(caller);
      return locked(
        staff,
        number,
        (ticket, c) => addNote(ticket, { staffId: staff.memberId, text: note }, c),
        { kind: 'note' },
      );
    },
  };
}

/** Take, and the taker's view counts as reading: one change, one version step. */
function takeAndRead(ticket: Ticket, staffId: string, c: TicketContext): TicketChange {
  const taken = take(ticket, { staffId }, c);
  const read = markReadByAssignee(taken.ticket, { staffId }, c);
  if (!read.changed) return taken;
  return { ...taken, ticket: read.ticket, changed: true };
}

export type StaffSupport = ReturnType<typeof createStaffSupport>;

// Audit and analytics derived from the facts of a change ------------------------------------------

interface AuditEntry {
  action: SupportAuditAction;
  details: Record<string, unknown>;
}

/** The one Audit log entry of a Staff action (FR-12); null when it changed nothing. */
function auditEntry(
  before: Ticket,
  facts: readonly TicketFact[],
  plan: AuditPlan,
): AuditEntry | null {
  const status = facts.find((f) => f.type === 'status_changed');
  const statusDetails = status ? { from: status.from, to: status.to } : {};
  const has = (type: TicketFact['type']) => facts.some((f) => f.type === type);
  switch (plan.kind) {
    case 'take':
      return has('taken') || status
        ? {
            action: 'support.taken',
            details: {
              from: before.assigneeId,
              ...(status ? { statusFrom: status.from, statusTo: status.to } : {}),
            },
          }
        : null;
    case 'assign': {
      const assigned = facts.find((f) => f.type === 'assigned');
      return assigned
        ? {
            action: 'support.assigned',
            details: { from: assigned.previousAssigneeId, to: assigned.assigneeId },
          }
        : null;
    }
    case 'status':
      if (!status) return null;
      return {
        action: has('closed')
          ? 'support.closed'
          : has('reopened')
            ? 'support.reopened'
            : 'support.status_changed',
        details: statusDetails,
      };
    case 'reply':
      return plan.then === 'close'
        ? { action: 'support.closed', details: { ...statusDetails, withReply: true } }
        : {
            action: 'support.replied',
            details: {
              waitOnCustomer: plan.then === 'wait_on_customer',
              ...(has('reopened') ? { reopened: true } : {}),
            },
          };
    case 'note':
      return { action: 'support.note_added', details: {} };
  }
}

function analyticsFor(
  fact: TicketFact,
  c: {
    before: Ticket;
    change: TicketChange;
    counts: { staffReplies: number; customerReplies: number };
    base: { ticket_number: number };
    now: Date;
  },
): { name: string; properties: Record<string, unknown> } | null {
  const { before, base, now } = c;
  switch (fact.type) {
    case 'staff_replied': {
      const properties: Record<string, unknown> = {
        ...base,
        by: 'staff',
        minutes_since_last: minutesBetween(before.lastMessageAt, now),
        is_first_staff_reply: fact.isFirstStaffReply,
      };
      if (fact.isFirstStaffReply) {
        properties.business_minutes_to_first_reply = fact.businessMinutesToFirstReply;
      }
      return { name: 'ticket_replied', properties };
    }
    case 'status_changed':
      return {
        name: 'ticket_status_changed',
        properties: { ...base, from: fact.from, to: fact.to, by: fact.by },
      };
    case 'closed':
      return {
        name: 'ticket_closed',
        properties: {
          ...base,
          by: fact.by,
          minutes_open: minutesBetween(before.createdAt, now),
          staff_replies: c.counts.staffReplies,
          customer_replies: c.counts.customerReplies,
        },
      };
    case 'reopened':
      return {
        name: 'ticket_reopened',
        properties: {
          ...base,
          by: fact.by,
          days_since_closed: before.closedAt
            ? Math.floor((now.getTime() - before.closedAt.getTime()) / DAY_MS)
            : 0,
        },
      };
    default:
      return null;
  }
}
