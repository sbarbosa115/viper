import { describe, expect, test } from 'vitest';
import { aTicket, FRIDAY, members, NOW, ticketIn } from '../test/factories.js';
import {
  customerOrder,
  decodeCursor,
  encodeCursor,
  pageOf,
  previewText,
  staffOrder,
  statsSince,
  supportStats,
} from './listing.js';
import type { Ticket } from './ticket.js';

const MIN = 60_000;
const ago = (min: number) => new Date(NOW.getTime() - min * MIN);
const numbers = (rows: Ticket[]) => rows.map((t) => t.number);

describe('FR-6: stats', () => {
  test('three first replies after 30, 90 and 600 business minutes → median 90', () => {
    const plus = (min: number) => new Date(FRIDAY.getTime() + min * MIN);
    // FRIDAY is 09:00 Chicago: 30 and 90 the same day; 600 = 480 Friday + 120 Monday.
    const monday11 = new Date('2026-11-23T17:00:00Z');
    const stats = supportStats({
      waiting: { count: 0, oldestStart: null },
      recent: [
        { createdAt: FRIDAY, firstStaffReplyAt: plus(30), closedAt: null },
        { createdAt: FRIDAY, firstStaffReplyAt: plus(90), closedAt: null },
        { createdAt: FRIDAY, firstStaffReplyAt: monday11, closedAt: null },
        { createdAt: FRIDAY, firstStaffReplyAt: null, closedAt: null },
      ],
      now: NOW,
    });
    expect(stats.firstReplyMedianBusinessMinutes30d).toBe(90);
  });

  test('closed within 3 days, longest wait, and nulls when there is nothing', () => {
    const day = 24 * 60;
    const stats = supportStats({
      waiting: { count: 2, oldestStart: ago(130) },
      recent: [
        { createdAt: ago(10 * day), firstStaffReplyAt: null, closedAt: ago(7 * day) },
        { createdAt: ago(10 * day), firstStaffReplyAt: null, closedAt: ago(6 * day) },
        { createdAt: ago(10 * day), firstStaffReplyAt: null, closedAt: null },
        { createdAt: ago(10 * day), firstStaffReplyAt: null, closedAt: ago(9 * day) },
      ],
      now: NOW,
    });
    expect(stats).toEqual({
      waiting: 2,
      longestWaitMinutes: 130,
      firstReplyMedianBusinessMinutes30d: null,
      closedWithin3DaysPct30d: 50,
    });
    expect(
      supportStats({ waiting: { count: 0, oldestStart: null }, recent: [], now: NOW }),
    ).toEqual({
      waiting: 0,
      longestWaitMinutes: null,
      firstReplyMedianBusinessMinutes30d: null,
      closedWithin3DaysPct30d: null,
    });
  });

  test('the window is the last 30 days', () => {
    expect(statsSince(NOW)).toEqual(new Date('2026-10-22T15:00:00Z'));
  });
});

describe('orderings and cursors', () => {
  const a = aTicket({
    number: 2001,
    createdAt: ago(120),
    waitingSince: null,
    lastMessageAt: ago(100),
  });
  const b = ticketIn('in_progress', {
    number: 2002,
    createdAt: ago(500),
    waitingSince: ago(52),
    lastMessageAt: ago(52),
  });
  const c = ticketIn('closed', { number: 2003, closedDaysAgo: 2 });
  const d = ticketIn('closed', { number: 2004, closedDaysAgo: 1 });

  test('FR-6 Waiting: longest wait first (coalesce(waitingSince, createdAt) asc)', () => {
    expect(numbers(pageOf([b, a], staffOrder('waiting'), (t) => t, null, 25).rows)).toEqual([
      2001, 2002,
    ]);
  });

  test('FR-1 customer all: not closed by lastMessageAt desc, then closed by closedAt desc', () => {
    const page = pageOf([c, a, d, b], customerOrder('all'), (t) => t, null, 25);
    expect(numbers(page.rows)).toEqual([2002, 2001, 2004, 2003]);
  });

  test('pages follow the cursor without gaps or repeats', () => {
    const order = customerOrder('all');
    const first = pageOf([c, a, d, b], order, (t) => t, null, 3);
    expect(numbers(first.rows)).toEqual([2002, 2001, 2004]);
    const second = pageOf([c, a, d, b], order, (t) => t, first.nextCursor, 3);
    expect(numbers(second.rows)).toEqual([2003]);
    expect(second.nextCursor).toBeNull();
  });

  test('ties on time are broken by number in the list direction', () => {
    const t1 = aTicket({ number: 3001, createdAt: ago(10) });
    const t2 = aTicket({ number: 3002, createdAt: ago(10) });
    expect(numbers(pageOf([t1, t2], staffOrder('all'), (t) => t, null, 25).rows)).toEqual([
      3002, 3001,
    ]);
    expect(numbers(pageOf([t2, t1], staffOrder('waiting'), (t) => t, null, 25).rows)).toEqual([
      3001, 3002,
    ]);
  });

  test('cursors round-trip; a malformed one starts from the top', () => {
    const key = { rank: 1, time: NOW, number: 1042 };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });

  test('previews keep 80 UTF-16 units without splitting a surrogate pair', () => {
    expect(previewText('short')).toBe('short');
    expect(previewText('x'.repeat(100))).toHaveLength(80);
    expect(previewText(`${'x'.repeat(79)}😀`)).toBe('x'.repeat(79));
  });

  test('Mine and Waiting on customer use lastMessageAt', () => {
    const mine1 = ticketIn('in_progress', {
      number: 4001,
      lastMessageAt: ago(5),
      assigneeId: members.staff1.id,
    });
    const mine2 = ticketIn('in_progress', {
      number: 4002,
      lastMessageAt: ago(1),
      assigneeId: members.staff1.id,
    });
    expect(numbers(pageOf([mine1, mine2], staffOrder('mine'), (t) => t, null, 25).rows)).toEqual([
      4002, 4001,
    ]);
    expect(
      numbers(pageOf([mine2, mine1], staffOrder('waiting_on_customer'), (t) => t, null, 25).rows),
    ).toEqual([4001, 4002]);
  });
});
