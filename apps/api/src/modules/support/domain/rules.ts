import {
  DUPLICATE_WINDOW_SECONDS,
  MESSAGES_PER_HOUR,
  OPEN_TICKET_LIMIT,
  TICKETS_PER_HOUR,
} from '@app/contracts/support';
import type { Actor } from '../../../shared/domain/actor.js';
import { minutesBetween, supportDate } from './business-time.js';
import { supportErrors } from './errors.js';
import type { Ticket } from './ticket.js';

/** support's business rules that aren't a transition (prd-support section 6, common rules). */

// Visibility and Acting as -------------------------------------------------------------------------

/** Who is looking at customer endpoints: the Business acted on and whether they are its Owner. */
export interface TicketViewer {
  readonly memberId: string;
  readonly businessId: string;
  readonly isOwner: boolean;
}

export function viewerFromActor(actor: Actor): TicketViewer {
  return {
    memberId: actor.memberId,
    businessId: actor.businessId,
    isOwner: actor.roles.includes('owner'),
  };
}

/** A Member sees a Ticket of their Business if they are the Owner or opened it. */
export function canSee(
  viewer: TicketViewer,
  ticket: Pick<Ticket, 'businessId' | 'openedByMemberId'>,
): boolean {
  if (ticket.businessId !== viewer.businessId) return false;
  return viewer.isOwner || ticket.openedByMemberId === viewer.memberId;
}

/** 404 TICKET_NOT_FOUND (never 403) for a missing or invisible Ticket; returns it otherwise. */
export function visibleOrNotFound<T extends Pick<Ticket, 'businessId' | 'openedByMemberId'>>(
  viewer: TicketViewer,
  ticket: T | null,
): T {
  if (!ticket || !canSee(viewer, ticket)) throw supportErrors.ticketNotFound();
  return ticket;
}

/** Staff Acting as a Business see its Tickets read-only. */
export function isReadOnly(actor: Actor): boolean {
  return actor.actingAs !== undefined;
}

/** 403 NOT_WHILE_ACTING_AS for customer writes (open, reply, close) while Acting as. */
export function assertNotActingAs(actor: Actor): void {
  if (isReadOnly(actor)) throw supportErrors.notWhileActingAs();
}

// Waiting queue -----------------------------------------------------------------------------------

type WaitFields = Pick<Ticket, 'status' | 'assigneeId' | 'waitingSince' | 'createdAt'>;

/**
 * Waiting (for Staff): `open` or `in_progress`, and unassigned or with a customer reply no Staff
 * has read (`waitingSince` set).
 */
export function isWaiting(ticket: WaitFields): boolean {
  if (ticket.status !== 'open' && ticket.status !== 'in_progress') return false;
  return ticket.assigneeId === null || ticket.waitingSince !== null;
}

/** "● new customer reply": a customer message no Staff has read yet. */
export function hasUnreadCustomerReply(ticket: WaitFields): boolean {
  return ticket.status !== 'closed' && ticket.waitingSince !== null;
}

/** When the wait started: `coalesce(waitingSince, createdAt)` (also the Waiting sort key). */
export function waitStart(ticket: WaitFields): Date {
  return ticket.waitingSince ?? ticket.createdAt;
}

/** Wall-clock minutes waiting for a Ticket in the Waiting queue; null otherwise. */
export function waitMinutes(ticket: WaitFields, now: Date): number | null {
  return isWaiting(ticket) ? minutesBetween(waitStart(ticket), now) : null;
}

// Limits ------------------------------------------------------------------------------------------

const HOUR_MS = 3600_000;

/** A rate-limit window's usage: how many in it and the oldest (when the window frees a slot). */
export interface WindowUsage {
  readonly count: number;
  readonly oldest: Date | null;
}

export const supportLimits = {
  ticketsPerMember: { max: TICKETS_PER_HOUR, windowMs: HOUR_MS },
  repliesPerMember: { max: MESSAGES_PER_HOUR, windowMs: HOUR_MS },
  duplicateWindowMs: DUPLICATE_WINDOW_SECONDS * 1000,
} as const;

export function windowStart(now: Date, windowMs: number): Date {
  return new Date(now.getTime() - windowMs);
}

/** 429 TOO_MANY_REQUESTS once the window is full; Retry-After = when its oldest entry leaves. */
export function assertUnderRateLimit(
  usage: WindowUsage,
  limit: { max: number; windowMs: number },
  now: Date,
): void {
  if (usage.count < limit.max) return;
  const frees = usage.oldest
    ? usage.oldest.getTime() + limit.windowMs
    : now.getTime() + limit.windowMs;
  throw supportErrors.tooManyRequests(Math.max(1, Math.ceil((frees - now.getTime()) / 1000)));
}

/** 422 OPEN_TICKET_LIMIT when the Business already has 5 Tickets not closed. */
export function assertUnderOpenLimit(openTickets: number): void {
  if (openTickets >= OPEN_TICKET_LIMIT) throw supportErrors.openTicketLimit();
}

// Audit -------------------------------------------------------------------------------------------

/** `support.ticket_viewed` is recorded once per Staff Member, Ticket and (Chicago) day. */
export function isFirstViewOfDay(previousViewAt: Date | null, now: Date): boolean {
  return previousViewAt === null || supportDate(previousViewAt) !== supportDate(now);
}
