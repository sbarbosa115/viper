import { PREVIEW_MAX, type StaffView, type TicketListFilter } from '@app/contracts/support';
import { businessMinutesBetween, median, minutesBetween } from './business-time.js';
import { isWaiting, waitStart, type TicketViewer } from './rules.js';
import type { Ticket, TicketCategory, TicketSide } from './ticket.js';

/**
 * The list orderings, filters and stats of FR-1 and FR-6 as pure functions. The Kysely repository
 * mirrors them in SQL; the in-memory fake uses them directly, and both pass the same contract
 * tests (test/ticket-repository-contract.ts).
 */

// Rows --------------------------------------------------------------------------------------------

/** A list row's preview: the last reply (not events or notes), its first 80 characters. */
export interface TicketPreview {
  readonly side: TicketSide;
  readonly authorMemberId: string | null;
  readonly text: string;
}

/** The first 80 UTF-16 units of a reply (never splitting a surrogate pair). */
export function previewText(body: string): string {
  if (body.length <= PREVIEW_MAX) return body;
  const cut = body.slice(0, PREVIEW_MAX);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

export interface TicketListItem {
  readonly ticket: Ticket;
  readonly lastReply: TicketPreview | null;
}

// Customer list (FR-1) ----------------------------------------------------------------------------

export type CustomerListFilter = TicketListFilter;

export interface CustomerListQuery {
  readonly viewer: TicketViewer;
  readonly filter: CustomerListFilter;
  readonly cursor: string | null;
  readonly limit: number;
}

export interface CustomerTicketPage {
  readonly items: TicketListItem[];
  /** Visible Tickets not closed / closed, whatever the filter. */
  readonly counts: { readonly open: number; readonly closed: number };
  readonly nextCursor: string | null;
}

export function inCustomerFilter(filter: CustomerListFilter, ticket: Ticket): boolean {
  if (filter === 'open') return ticket.status !== 'closed';
  if (filter === 'closed') return ticket.status === 'closed';
  return true;
}

// Staff list (FR-6) -------------------------------------------------------------------------------

export type SupportStaffView = StaffView;

export interface StaffListQuery {
  readonly view: SupportStaffView;
  /** The Staff Member asking ("Mine", and what `me` resolves to). */
  readonly staffId: string;
  readonly category?: TicketCategory | undefined;
  /** undefined = Anyone; null = Nobody; an id = that Staff Member (resolve `me` first). */
  readonly assigneeId?: string | null | undefined;
  readonly cursor: string | null;
  readonly limit: number;
}

export interface StaffTicketPage {
  readonly items: TicketListItem[];
  readonly nextCursor: string | null;
}

/** The view chips' counts; filters don't apply (like the nav badge). */
export interface StaffCounts {
  readonly waiting: number;
  readonly mine: number;
  readonly waitingOnCustomer: number;
}

export function inStaffView(view: SupportStaffView, ticket: Ticket, staffId: string): boolean {
  switch (view) {
    case 'waiting':
      return isWaiting(ticket);
    case 'mine':
      return ticket.assigneeId === staffId && ticket.status !== 'closed';
    case 'waiting_on_customer':
      return ticket.status === 'waiting_on_customer';
    case 'closed':
      return ticket.status === 'closed';
    case 'all':
      return true;
  }
}

export function matchesStaffFilters(query: StaffListQuery, ticket: Ticket): boolean {
  if (query.category !== undefined && ticket.category !== query.category) return false;
  if (query.assigneeId !== undefined && ticket.assigneeId !== query.assigneeId) return false;
  return inStaffView(query.view, ticket, query.staffId);
}

// Ordering and cursors ----------------------------------------------------------------------------

/**
 * Keyset position: `rank` ascending first (customer `all`: not closed before closed), then
 * `time` and `number` both in the list's direction.
 */
export interface SortKey {
  readonly rank: number;
  readonly time: Date;
  readonly number: number;
}

export type SortDirection = 'asc' | 'desc';

export interface ListOrder {
  readonly direction: SortDirection;
  key(ticket: Ticket): SortKey;
}

const key = (rank: number, time: Date | null, ticket: Ticket): SortKey => ({
  rank,
  time: time ?? ticket.createdAt,
  number: ticket.number,
});

/** Open: by `lastMessageAt` desc. Closed: by `closedAt` desc. All: open ones first, then closed. */
export function customerOrder(filter: CustomerListFilter): ListOrder {
  return {
    direction: 'desc',
    key: (t) =>
      t.status === 'closed'
        ? key(filter === 'all' ? 1 : 0, t.closedAt, t)
        : key(0, t.lastMessageAt, t),
  };
}

/** Waiting: longest wait first. Mine: `lastMessageAt` desc. Waiting on customer: asc. Closed: `closedAt` desc. All: `createdAt` desc. */
export function staffOrder(view: SupportStaffView): ListOrder {
  switch (view) {
    case 'waiting':
      return { direction: 'asc', key: (t) => key(0, waitStart(t), t) };
    case 'mine':
      return { direction: 'desc', key: (t) => key(0, t.lastMessageAt, t) };
    case 'waiting_on_customer':
      return { direction: 'asc', key: (t) => key(0, t.lastMessageAt, t) };
    case 'closed':
      return { direction: 'desc', key: (t) => key(0, t.closedAt, t) };
    case 'all':
      return { direction: 'desc', key: (t) => key(0, t.createdAt, t) };
  }
}

/** Negative when `a` comes before `b` in a list with this direction. */
export function compareKeys(a: SortKey, b: SortKey, direction: SortDirection): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const sign = direction === 'asc' ? 1 : -1;
  const byTime = a.time.getTime() - b.time.getTime();
  if (byTime !== 0) return sign * byTime;
  return sign * (a.number - b.number);
}

/** An opaque cursor: the last row's key, base64url JSON. */
export function encodeCursor(k: SortKey): string {
  return Buffer.from(JSON.stringify([k.rank, k.time.getTime(), k.number])).toString('base64url');
}

/** The key a cursor holds; null for a malformed cursor (the list starts from the top). */
export function decodeCursor(cursor: string | null): SortKey | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [rank, time, number] = parsed as unknown[];
    if (typeof rank !== 'number' || typeof time !== 'number' || typeof number !== 'number') {
      return null;
    }
    return { rank, time: new Date(time), number };
  } catch {
    return null;
  }
}

/** One page of rows already filtered: sorted, after the cursor, at most `limit` (the fake's pager). */
export function pageOf<T>(
  rows: readonly T[],
  order: ListOrder,
  ticketOf: (row: T) => Ticket,
  cursor: string | null,
  limit: number,
): { rows: T[]; nextCursor: string | null } {
  const after = decodeCursor(cursor);
  const sorted = [...rows]
    .map((row) => ({ row, k: order.key(ticketOf(row)) }))
    .sort((a, b) => compareKeys(a.k, b.k, order.direction))
    .filter((r) => !after || compareKeys(r.k, after, order.direction) > 0);
  const page = sorted.slice(0, limit);
  const last = page.at(-1);
  return {
    rows: page.map((r) => r.row),
    nextCursor: sorted.length > limit && last ? encodeCursor(last.k) : null,
  };
}

// Stats (FR-6) ------------------------------------------------------------------------------------

export const STATS_WINDOW_DAYS = 30;
const CLOSED_WITHIN_MS = 3 * 24 * 3600 * 1000;

/** The start of the stats window: Tickets opened since then count. */
export function statsSince(now: Date): Date {
  return new Date(now.getTime() - STATS_WINDOW_DAYS * 24 * 3600 * 1000);
}

/** The times of one Ticket opened in the stats window. */
export interface TicketTimes {
  readonly createdAt: Date;
  readonly firstStaffReplyAt: Date | null;
  readonly closedAt: Date | null;
}

export interface WaitingSummary {
  readonly count: number;
  /** The earliest `coalesce(waitingSince, createdAt)` among waiting Tickets. */
  readonly oldestStart: Date | null;
}

export interface SupportStats {
  waiting: number;
  longestWaitMinutes: number | null;
  firstReplyMedianBusinessMinutes30d: number | null;
  closedWithin3DaysPct30d: number | null;
}

/** The stats strip; null where there's nothing to measure. */
export function supportStats(input: {
  waiting: WaitingSummary;
  recent: readonly TicketTimes[];
  now: Date;
}): SupportStats {
  const { waiting, recent, now } = input;
  const firstReplies = recent.flatMap((t) =>
    t.firstStaffReplyAt ? [businessMinutesBetween(t.createdAt, t.firstStaffReplyAt)] : [],
  );
  const closedFast = recent.filter(
    (t) => t.closedAt && t.closedAt.getTime() - t.createdAt.getTime() <= CLOSED_WITHIN_MS,
  ).length;
  return {
    waiting: waiting.count,
    longestWaitMinutes: waiting.oldestStart ? minutesBetween(waiting.oldestStart, now) : null,
    firstReplyMedianBusinessMinutes30d: median(firstReplies),
    closedWithin3DaysPct30d:
      recent.length === 0 ? null : Math.round((closedFast / recent.length) * 100),
  };
}
