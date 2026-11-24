import type { Actor } from '../../../shared/domain/actor.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import type { MemberSummary } from '../index.js';
import type { TicketViewer } from '../domain/rules.js';
import type { OpenTicketInput, Ticket, TicketContext, TicketStatus } from '../domain/ticket.js';

/**
 * support's test factories (fixed ids, the PRD's fixed clock, Tickets in every status).
 *
 * - `NOW` is the PRD's fixed clock, Saturday 2026-11-21 15:00Z; `FRIDAY` (2026-11-20 15:00Z,
 *   09:00 Chicago) is for business-hour cases. `fixedClock()` and `ticketCtx()` wrap them.
 * - Two Businesses: A (Owner `ownerA`, Member `memberA`) and B (`ownerB`); two Staff Members
 *   (`staff1`, `staff2`, on the internal Business). `members` holds them as identity's
 *   MemberSummary; `viewers` and `actors` as the customer side sees them.
 * - `aTicket(overrides)` builds a Ticket state directly (no transition), `ticketIn(status)` a
 *   coherent one in each status, `openInput()` the input of `openTicket`.
 */

export const NOW = new Date('2026-11-21T15:00:00.000Z');
export const FRIDAY = new Date('2026-11-20T15:00:00.000Z');

export const BUSINESS_A = 'b0000000-0000-4000-8000-00000000000a';
export const BUSINESS_B = 'b0000000-0000-4000-8000-00000000000b';
export const INTERNAL_BUSINESS = 'b0000000-0000-4000-8000-0000000000ff';
export const RUN_ID = 'c0000000-0000-4000-8000-000000000001';

const member = (
  n: string,
  name: string,
  businessId: string,
  role: 'owner' | 'member',
  isStaff = false,
): MemberSummary => ({
  id: `a0000000-0000-4000-8000-0000000000${n}`,
  name,
  email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.test`,
  businessId,
  role,
  isStaff,
});

export const members = {
  ownerA: member('a1', 'Ana Owner', BUSINESS_A, 'owner'),
  memberA: member('a2', 'Jo Kim', BUSINESS_A, 'member'),
  ownerB: member('b1', 'Bea Other', BUSINESS_B, 'owner'),
  staff1: member('f1', 'Sam Staff', INTERNAL_BUSINESS, 'owner', true),
  staff2: member('f2', 'Lee Staff', INTERNAL_BUSINESS, 'member', true),
} as const;

export const viewers = {
  ownerA: { memberId: members.ownerA.id, businessId: BUSINESS_A, isOwner: true },
  memberA: { memberId: members.memberA.id, businessId: BUSINESS_A, isOwner: false },
  ownerB: { memberId: members.ownerB.id, businessId: BUSINESS_B, isOwner: true },
} satisfies Record<string, TicketViewer>;

export const actors = {
  ownerA: {
    memberId: members.ownerA.id,
    businessId: BUSINESS_A,
    roles: ['owner'],
    emailVerified: true,
  },
  memberA: { memberId: members.memberA.id, businessId: BUSINESS_A, roles: [], emailVerified: true },
  /** Staff 1 Acting as Business A: read-only on customer pages. */
  staffActingAsA: {
    memberId: members.staff1.id,
    businessId: BUSINESS_A,
    roles: ['owner', 'staff'],
    emailVerified: true,
    actingAs: {
      businessId: BUSINESS_A,
      businessName: 'Sweet Supply',
      staffMemberId: members.staff1.id,
    },
  },
} satisfies Record<string, Actor>;

export function fixedClock(at: Date = NOW): FixedClock {
  return new FixedClock(at);
}

/** A command context at `at` with sequential message ids. */
export function ticketCtx(at: Date = NOW, ids = new SequentialIdGenerator()): TicketContext {
  return { now: at, ids };
}

const HOUR = 3600_000;
let nextNumber = 1001;

/** A Ticket state as stored: open, unassigned, opened by `memberA` an hour before NOW. */
export function aTicket(overrides: Partial<Ticket> = {}): Ticket {
  const number = overrides.number ?? nextNumber++;
  const createdAt = overrides.createdAt ?? new Date(NOW.getTime() - HOUR);
  return {
    id: `d0000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
    number,
    businessId: BUSINESS_A,
    openedByMemberId: members.memberA.id,
    category: 'run',
    subject: 'My run failed',
    status: 'open',
    assigneeId: null,
    runId: null,
    source: 'help',
    pagePath: null,
    balanceAtOpen: 120,
    version: 0,
    waitingSince: createdAt,
    firstStaffReplyAt: null,
    lastMessageAt: createdAt,
    lastMessageBy: 'customer',
    closedAt: null,
    closedBy: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

/**
 * A coherent Ticket in `status`: `in_progress` and `waiting_on_customer` are assigned to staff1
 * and read (no `waitingSince`); `closed` was closed by Staff `closedDaysAgo` days before NOW
 * (default 1), still assigned.
 */
export function ticketIn(
  status: TicketStatus,
  overrides: Partial<Ticket> & { closedDaysAgo?: number } = {},
): Ticket {
  const { closedDaysAgo = 1, ...rest } = overrides;
  const base = aTicket({ createdAt: new Date(NOW.getTime() - 40 * 24 * HOUR), ...rest });
  const replied = new Date(base.createdAt.getTime() + HOUR);
  switch (status) {
    case 'open':
      return { ...base, ...rest };
    case 'in_progress':
      return {
        ...base,
        status,
        assigneeId: members.staff1.id,
        waitingSince: null,
        firstStaffReplyAt: replied,
        lastMessageAt: replied,
        lastMessageBy: 'staff',
        version: 2,
        ...rest,
      };
    case 'waiting_on_customer':
      return {
        ...base,
        status,
        assigneeId: members.staff1.id,
        waitingSince: null,
        firstStaffReplyAt: replied,
        lastMessageAt: replied,
        lastMessageBy: 'staff',
        version: 3,
        ...rest,
      };
    case 'closed': {
      const closedAt = new Date(NOW.getTime() - closedDaysAgo * 24 * HOUR);
      return {
        ...base,
        status,
        assigneeId: members.staff1.id,
        waitingSince: null,
        firstStaffReplyAt: replied,
        lastMessageAt: closedAt,
        lastMessageBy: 'staff',
        closedAt,
        closedBy: 'staff',
        version: 4,
        ...rest,
      };
    }
  }
}

/** The input of `openTicket` for `memberA` of Business A. */
export function openInput(overrides: Partial<OpenTicketInput> = {}): OpenTicketInput {
  return {
    id: `d1000000-0000-4000-8000-${String(nextNumber++).padStart(12, '0')}`,
    businessId: BUSINESS_A,
    openedByMemberId: members.memberA.id,
    category: 'run',
    subject: 'My run failed',
    message: 'It stopped at step 3 and charged me.',
    runId: null,
    source: 'help',
    pagePath: '/app/runs/123',
    balanceAtOpen: 120,
    ...overrides,
  };
}
