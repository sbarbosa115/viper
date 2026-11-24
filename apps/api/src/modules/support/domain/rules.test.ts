import { describe, expect, test } from 'vitest';
import { CodedError } from '../../../shared/domain/errors.js';
import { actors, aTicket, BUSINESS_B, members, NOW, ticketIn, viewers } from '../test/factories.js';
import {
  assertNotActingAs,
  assertUnderOpenLimit,
  assertUnderRateLimit,
  canSee,
  hasUnreadCustomerReply,
  isFirstViewOfDay,
  isReadOnly,
  isWaiting,
  supportLimits,
  viewerFromActor,
  visibleOrNotFound,
  waitMinutes,
} from './rules.js';

const MIN = 60_000;

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof CodedError ? e.code : String(e);
  }
}

describe('visibility: same Business and (Owner or opener)', () => {
  const byMember = aTicket({ openedByMemberId: members.memberA.id });
  const byOwner = aTicket({ openedByMemberId: members.ownerA.id });
  const otherBusiness = aTicket({ businessId: BUSINESS_B, openedByMemberId: members.ownerB.id });
  test.each([
    ['the Owner sees a Member’s Ticket', viewers.ownerA, byMember, true],
    ['the Owner sees their own', viewers.ownerA, byOwner, true],
    ['a Member sees the Ticket they opened', viewers.memberA, byMember, true],
    ['a Member doesn’t see the Owner’s Ticket', viewers.memberA, byOwner, false],
    ['nobody sees another Business’s Ticket', viewers.ownerA, otherBusiness, false],
    ['the other Owner sees their own', viewers.ownerB, otherBusiness, true],
  ])('%s', (_label, viewer, ticket, visible) => {
    expect(canSee(viewer, ticket)).toBe(visible);
  });

  test('invisible and missing Tickets are both 404 TICKET_NOT_FOUND', () => {
    expect(codeOf(() => visibleOrNotFound(viewers.memberA, byOwner))).toBe('TICKET_NOT_FOUND');
    expect(codeOf(() => visibleOrNotFound(viewers.memberA, null))).toBe('TICKET_NOT_FOUND');
    expect(visibleOrNotFound(viewers.memberA, byMember)).toBe(byMember);
  });

  test('viewerFromActor: Owner from roles; Acting as Staff see the Business as its Owner', () => {
    expect(viewerFromActor(actors.memberA)).toEqual(viewers.memberA);
    expect(viewerFromActor(actors.ownerA)).toEqual(viewers.ownerA);
    expect(viewerFromActor(actors.staffActingAsA).isOwner).toBe(true);
  });
});

describe('Acting as is read-only', () => {
  test('customer writes answer 403 NOT_WHILE_ACTING_AS while Acting as', () => {
    expect(isReadOnly(actors.staffActingAsA)).toBe(true);
    expect(isReadOnly(actors.memberA)).toBe(false);
    expect(codeOf(() => assertNotActingAs(actors.staffActingAsA))).toBe('NOT_WHILE_ACTING_AS');
    expect(() => assertNotActingAs(actors.ownerA)).not.toThrow();
  });
});

describe('waiting rule', () => {
  const ago = (min: number) => new Date(NOW.getTime() - min * MIN);
  test.each([
    ['open, unassigned', aTicket({ waitingSince: null }), true],
    ['open, assigned, read', aTicket({ assigneeId: members.staff1.id, waitingSince: null }), false],
    ['open, assigned, unread reply', aTicket({ assigneeId: members.staff1.id }), true],
    ['in_progress, assigned, read', ticketIn('in_progress'), false],
    [
      'in_progress, assigned, unread reply',
      ticketIn('in_progress', { waitingSince: ago(52) }),
      true,
    ],
    ['in_progress, unassigned', ticketIn('in_progress', { assigneeId: null }), true],
    [
      'waiting_on_customer, unread',
      ticketIn('waiting_on_customer', { waitingSince: ago(5) }),
      false,
    ],
    [
      'waiting_on_customer, unassigned',
      ticketIn('waiting_on_customer', { assigneeId: null }),
      false,
    ],
    ['closed, unassigned', ticketIn('closed', { assigneeId: null }), false],
  ])('%s → waiting %s', (_label, ticket, waiting) => {
    expect(isWaiting(ticket)).toBe(waiting);
  });

  test('wait time = now − coalesce(waitingSince, createdAt), null outside the queue', () => {
    expect(waitMinutes(aTicket({ createdAt: ago(130), waitingSince: ago(130) }), NOW)).toBe(130);
    expect(waitMinutes(aTicket({ createdAt: ago(130), waitingSince: null }), NOW)).toBe(130);
    expect(waitMinutes(ticketIn('in_progress', { waitingSince: ago(52) }), NOW)).toBe(52);
    expect(waitMinutes(ticketIn('in_progress'), NOW)).toBeNull();
  });

  test('unread customer reply = waitingSince set on a Ticket not closed', () => {
    expect(hasUnreadCustomerReply(ticketIn('in_progress', { waitingSince: ago(1) }))).toBe(true);
    expect(hasUnreadCustomerReply(ticketIn('in_progress'))).toBe(false);
  });
});

describe('limits', () => {
  test('FR-2: 5 Tickets not closed per Business → 422 OPEN_TICKET_LIMIT', () => {
    expect(() => assertUnderOpenLimit(4)).not.toThrow();
    const error = (() => {
      try {
        assertUnderOpenLimit(5);
      } catch (e) {
        return e as CodedError;
      }
    })();
    expect(error?.code).toBe('OPEN_TICKET_LIMIT');
    expect(error?.status).toBe(422);
    expect(error?.details).toEqual({ limit: 5 });
  });

  test('FR-2: the 11th Ticket in an hour → 429 with Retry-After from the oldest', () => {
    const limit = supportLimits.ticketsPerMember;
    expect(() => assertUnderRateLimit({ count: 9, oldest: NOW }, limit, NOW)).not.toThrow();
    try {
      assertUnderRateLimit({ count: 10, oldest: new Date(NOW.getTime() - 50 * MIN) }, limit, NOW);
      expect.unreachable();
    } catch (e) {
      expect((e as CodedError).code).toBe('TOO_MANY_REQUESTS');
      expect((e as CodedError).details).toEqual({ retryAfterSeconds: 600 });
    }
  });

  test('FR-4: 30 customer messages per hour', () => {
    expect(supportLimits.repliesPerMember.max).toBe(30);
    expect(
      codeOf(() =>
        assertUnderRateLimit({ count: 30, oldest: NOW }, supportLimits.repliesPerMember, NOW),
      ),
    ).toBe('TOO_MANY_REQUESTS');
  });
});

describe('view audit once per day', () => {
  test.each([
    [null, '2026-11-21T15:00:00Z', true],
    ['2026-11-21T14:00:00Z', '2026-11-21T15:00:00Z', false],
    // 05:59Z is still the 20th in Chicago.
    ['2026-11-21T05:59:00Z', '2026-11-21T06:01:00Z', true],
  ])('previous %s, now %s → first of the day %s', (previous, now, first) => {
    expect(isFirstViewOfDay(previous ? new Date(previous) : null, new Date(now))).toBe(first);
  });
});
