import {
  MESSAGE_MAX,
  MESSAGE_MIN,
  PAGE_PATH_MAX,
  REOPEN_DAYS,
  SUBJECT_MAX,
  SUBJECT_MIN,
  TEXT_MAX,
  TEXT_MIN,
  type Category,
  type ReplyThen,
  type Source,
  type Status,
} from '@app/contracts/support';
import { ValidationError } from '../../../shared/domain/errors.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import { businessMinutesBetween } from './business-time.js';
import { supportErrors } from './errors.js';

/**
 * The Ticket aggregate (prd-support FR-2, FR-4, FR-5, FR-7 to FR-10, ADR 0021).
 *
 * A Ticket is an immutable value. Every command is a pure function `(ticket, input, ctx) →
 * TicketChange`: the new state, the messages to append, the outbox events to publish and the
 * facts the use case turns into Audit log entries and analytics. Nothing here does I/O; the use
 * case persists a change with `TicketRepository.saveChange` and publishes `outboxEvents(...)`.
 *
 * Every state change increments `version` and sets `updatedAt`; a command that changes nothing
 * (an Internal note, taking a Ticket you already have) returns `changed: false` with the version
 * untouched.
 */

export type TicketStatus = Status;
export type TicketCategory = Category;
export type TicketSource = Source;
/** Who wrote the last message or closed the Ticket. */
export type TicketSide = 'customer' | 'staff';

export interface Ticket {
  readonly id: string;
  /** AUTO_INCREMENT from 1001; shown as `#1042`. */
  readonly number: number;
  readonly businessId: string;
  readonly openedByMemberId: string;
  readonly category: TicketCategory;
  readonly subject: string;
  readonly status: TicketStatus;
  readonly assigneeId: string | null;
  readonly runId: string | null;
  readonly source: TicketSource;
  readonly pagePath: string | null;
  readonly balanceAtOpen: number | null;
  readonly version: number;
  /** Set on open and on a customer reply (if null); cleared by a Staff reply, the assignee viewing, and close. */
  readonly waitingSince: Date | null;
  readonly firstStaffReplyAt: Date | null;
  readonly lastMessageAt: Date;
  readonly lastMessageBy: TicketSide;
  readonly closedAt: Date | null;
  readonly closedBy: TicketSide | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A Ticket before its row exists: the number comes from AUTO_INCREMENT on insert. */
export type NewTicket = Omit<Ticket, 'number'>;

export type TicketMessageKind = 'customer_reply' | 'staff_reply' | 'internal_note' | 'event';

/** What a message of kind `event` records. Take and assign events are Staff-only. */
export type TicketMessageEvent =
  | { readonly type: 'status_changed'; readonly from: TicketStatus; readonly to: TicketStatus }
  | { readonly type: 'taken' }
  | { readonly type: 'assigned'; readonly assigneeId: string | null };

/** Immutable once written. */
export interface TicketMessage {
  readonly id: string;
  readonly ticketId: string;
  readonly kind: TicketMessageKind;
  /** The writer, or who did it for events. */
  readonly authorMemberId: string | null;
  /** Plain text; null for events. */
  readonly body: string | null;
  readonly event: TicketMessageEvent | null;
  /** A Staff reply the email consumer has sent to the opener. */
  readonly emailed: boolean;
  readonly createdAt: Date;
}

/** Outbox events (FR-11), before the Ticket's ids are attached (see `outboxEvents`). */
export type TicketEvent =
  | { readonly type: 'TicketOpened'; readonly messageId: string }
  | { readonly type: 'CustomerReplied'; readonly messageId: string }
  | { readonly type: 'StaffReplied'; readonly messageId: string }
  | {
      readonly type: 'TicketClosed';
      /** The closing reply sent with it (one email for both), or null. */
      readonly messageId: string | null;
      readonly closedBy: TicketSide;
    };

/**
 * What happened, for the Audit log and analytics. `status_changed` accompanies every status
 * change; `closed` and `reopened` are added when the change closes or reopens the Ticket.
 */
export type TicketFact =
  | { readonly type: 'opened' }
  | { readonly type: 'customer_replied'; readonly messageId: string }
  | {
      readonly type: 'staff_replied';
      readonly messageId: string;
      readonly isFirstStaffReply: boolean;
      /** Business minutes from `createdAt` to this reply, for the first Staff reply only. */
      readonly businessMinutesToFirstReply: number | null;
    }
  | { readonly type: 'note_added'; readonly messageId: string }
  | {
      readonly type: 'status_changed';
      readonly from: TicketStatus;
      readonly to: TicketStatus;
      readonly by: TicketSide;
    }
  | { readonly type: 'closed'; readonly by: TicketSide }
  | { readonly type: 'reopened'; readonly by: TicketSide }
  | { readonly type: 'taken'; readonly previousAssigneeId: string | null }
  | {
      readonly type: 'assigned';
      readonly assigneeId: string | null;
      readonly previousAssigneeId: string | null;
    }
  | { readonly type: 'marked_read' };

/** The clock reading and id source a command uses (inject Clock and IdGenerator). */
export interface TicketContext {
  readonly now: Date;
  readonly ids: IdGenerator;
}

/** The result of every command on an existing Ticket. */
export interface TicketChange {
  readonly ticket: Ticket;
  /** The version the command read: `saveChange` updates `WHERE version = expectedVersion`. */
  readonly expectedVersion: number;
  /** False when the row needs no update (an Internal note, a no-op take or assign). */
  readonly changed: boolean;
  /** Oldest first; their `createdAt` is `ctx.now` and their ids sort in this order. */
  readonly messages: readonly TicketMessage[];
  readonly events: readonly TicketEvent[];
  readonly facts: readonly TicketFact[];
}

/** The result of `openTicket`. */
export interface OpenedTicket {
  readonly ticket: NewTicket;
  readonly messages: readonly TicketMessage[];
  readonly events: readonly TicketEvent[];
  readonly facts: readonly TicketFact[];
}

const DAY_MS = 24 * 3600 * 1000;

// Text --------------------------------------------------------------------------------------------

/** Trims and checks plain text; line breaks are kept. Throws ValidationError for `field`. */
export function plainText(raw: string, min: number, max: number, field: string): string {
  const value = raw.trim();
  if (value.length < min || value.length > max) {
    throw new ValidationError('The request is not valid', {
      [field]: `Must be ${String(min)} to ${String(max)} characters`,
    });
  }
  return value;
}

/** The page the Member came from: kept if it starts with `/app/` and is ≤ 200 characters. */
export function normalizePagePath(from: string | null | undefined): string | null {
  if (!from?.startsWith('/app/') || from.length > PAGE_PATH_MAX) return null;
  return from;
}

// Reopen window -----------------------------------------------------------------------------------

/** `closedAt + 30 days` for a closed Ticket; null otherwise. */
export function reopenUntil(ticket: Pick<Ticket, 'status' | 'closedAt'>): Date | null {
  if (ticket.status !== 'closed' || !ticket.closedAt) return null;
  return new Date(ticket.closedAt.getTime() + REOPEN_DAYS * DAY_MS);
}

/** True while a reply (from either side) may still reopen this closed Ticket. */
export function canReopen(ticket: Pick<Ticket, 'status' | 'closedAt'>, now: Date): boolean {
  const until = reopenUntil(ticket);
  return until === null || now.getTime() <= until.getTime();
}

function assertCanReopen(ticket: Ticket, now: Date): void {
  if (!canReopen(ticket, now) && ticket.closedAt) {
    throw supportErrors.ticketClosedTooLong(ticket.closedAt);
  }
}

/** Throws 409 VERSION_CONFLICT when the caller's version is stale (take, assign, status). */
export function assertVersion(ticket: Ticket, version: number): void {
  if (ticket.version !== version) throw supportErrors.versionConflict(ticket.number);
}

// The working copy every command builds -----------------------------------------------------------

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const sameValue = (a: unknown, b: unknown): boolean =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

class Transition {
  readonly state: Mutable<Ticket>;
  readonly messages: TicketMessage[] = [];
  readonly events: TicketEvent[] = [];
  readonly facts: TicketFact[] = [];

  constructor(
    private readonly before: Ticket,
    private readonly ctx: TicketContext,
  ) {
    this.state = { ...before };
  }

  message(
    kind: TicketMessageKind,
    authorMemberId: string,
    body: string | null,
    event: TicketMessageEvent | null = null,
  ): TicketMessage {
    const message: TicketMessage = {
      id: this.ctx.ids.next(),
      ticketId: this.state.id,
      kind,
      authorMemberId,
      body,
      event,
      emailed: false,
      createdAt: this.ctx.now,
    };
    this.messages.push(message);
    return message;
  }

  /** Moves to `to` with one status event; closing and reopening set and clear the close fields. */
  moveTo(to: TicketStatus, by: TicketSide, actorId: string): void {
    const from = this.state.status;
    if (from === to) return;
    this.message('event', actorId, null, { type: 'status_changed', from, to });
    this.facts.push({ type: 'status_changed', from, to, by });
    this.state.status = to;
    if (to === 'closed') {
      this.state.closedAt = this.ctx.now;
      this.state.closedBy = by;
      this.state.waitingSince = null;
      this.facts.push({ type: 'closed', by });
    } else if (from === 'closed') {
      this.state.closedAt = null;
      this.state.closedBy = null;
      this.facts.push({ type: 'reopened', by });
    }
  }

  finish(): TicketChange {
    const changed = (Object.keys(this.state) as (keyof Ticket)[]).some(
      (key) => !sameValue(this.state[key], this.before[key]),
    );
    if (changed) {
      this.state.version = this.before.version + 1;
      this.state.updatedAt = this.ctx.now;
    }
    return {
      ticket: { ...this.state },
      expectedVersion: this.before.version,
      changed,
      messages: this.messages,
      events: this.events,
      facts: this.facts,
    };
  }
}

// Commands ----------------------------------------------------------------------------------------

export interface OpenTicketInput {
  id: string;
  businessId: string;
  openedByMemberId: string;
  category: TicketCategory;
  subject: string;
  message: string;
  runId: string | null;
  source: TicketSource;
  /** The raw `from` path; `normalizePagePath` decides whether it's kept. */
  pagePath: string | null;
  balanceAtOpen: number | null;
}

/** FR-2: a new `open` Ticket, waiting since now, with the first message as a customer reply. */
export function openTicket(input: OpenTicketInput, ctx: TicketContext): OpenedTicket {
  const subject = plainText(input.subject, SUBJECT_MIN, SUBJECT_MAX, 'subject');
  const body = plainText(input.message, MESSAGE_MIN, MESSAGE_MAX, 'message');
  const now = ctx.now;
  const ticket: NewTicket = {
    id: input.id,
    businessId: input.businessId,
    openedByMemberId: input.openedByMemberId,
    category: input.category,
    subject,
    status: 'open',
    assigneeId: null,
    runId: input.runId,
    source: input.source,
    pagePath: normalizePagePath(input.pagePath),
    balanceAtOpen: input.balanceAtOpen,
    version: 0,
    waitingSince: now,
    firstStaffReplyAt: null,
    lastMessageAt: now,
    lastMessageBy: 'customer',
    closedAt: null,
    closedBy: null,
    createdAt: now,
    updatedAt: now,
  };
  const message: TicketMessage = {
    id: ctx.ids.next(),
    ticketId: input.id,
    kind: 'customer_reply',
    authorMemberId: input.openedByMemberId,
    body,
    event: null,
    emailed: false,
    createdAt: now,
  };
  return {
    ticket,
    messages: [message],
    events: [{ type: 'TicketOpened', messageId: message.id }],
    facts: [{ type: 'opened' }],
  };
}

/** The Ticket once its row has a number. */
export function withNumber(ticket: NewTicket, number: number): Ticket {
  return { ...ticket, number };
}

/**
 * FR-4: a customer reply. `waiting_on_customer` → `in_progress` if assigned, else `open`; a
 * closed Ticket within the reopen window → `open` (assignee kept, `reopened` fact); after the
 * window 409 TICKET_CLOSED_TOO_LONG. Sets `waitingSince` if null. Visibility and Acting as are
 * the use case's checks.
 */
export function customerReply(
  ticket: Ticket,
  input: { memberId: string; text: string },
  ctx: TicketContext,
): TicketChange {
  const body = plainText(input.text, TEXT_MIN, TEXT_MAX, 'message');
  assertCanReopen(ticket, ctx.now);
  const t = new Transition(ticket, ctx);
  const reply = t.message('customer_reply', input.memberId, body);
  if (ticket.status === 'closed') t.moveTo('open', 'customer', input.memberId);
  if (ticket.status === 'waiting_on_customer') {
    t.moveTo(ticket.assigneeId ? 'in_progress' : 'open', 'customer', input.memberId);
  }
  t.state.waitingSince ??= ctx.now;
  t.state.lastMessageAt = ctx.now;
  t.state.lastMessageBy = 'customer';
  t.events.push({ type: 'CustomerReplied', messageId: reply.id });
  t.facts.push({ type: 'customer_replied', messageId: reply.id });
  return t.finish();
}

/** FR-5: the customer closes; 409 ALREADY_CLOSED if it is closed. No email (the consumer skips it). */
export function customerClose(
  ticket: Ticket,
  input: { memberId: string },
  ctx: TicketContext,
): TicketChange {
  if (ticket.status === 'closed') throw supportErrors.alreadyClosed();
  const t = new Transition(ticket, ctx);
  t.moveTo('closed', 'customer', input.memberId);
  t.events.push({ type: 'TicketClosed', messageId: null, closedBy: 'customer' });
  return t.finish();
}

/**
 * FR-9: a Staff reply, optionally followed by Reply & wait (`wait_on_customer`) or Close
 * (`close`). `open` (or closed within the window) → `in_progress`, and an unassigned Ticket leaving
 * `open`/`closed` gets the replier (with Reply & wait and Close too, "as Reply, then …"); clears `waitingSince`; sets `firstStaffReplyAt` once. Publishes `StaffReplied`,
 * or with `close` a single `TicketClosed` carrying the reply's messageId (one email for both).
 * Replies need no version: they never overwrite.
 */
export function staffReply(
  ticket: Ticket,
  input: { staffId: string; text: string; then?: ReplyThen | undefined },
  ctx: TicketContext,
): TicketChange {
  const body = plainText(input.text, TEXT_MIN, TEXT_MAX, 'message');
  assertCanReopen(ticket, ctx.now);
  const t = new Transition(ticket, ctx);
  const reply = t.message('staff_reply', input.staffId, body);
  const isFirst = ticket.firstStaffReplyAt === null;

  let target: TicketStatus = ticket.status;
  if (ticket.status === 'open' || ticket.status === 'closed') target = 'in_progress';
  if (input.then === 'wait_on_customer') target = 'waiting_on_customer';
  if (input.then === 'close') target = 'closed';
  const leavesOpenOrClosed =
    ticket.status === 'open' || (ticket.status === 'closed' && target !== 'closed');
  if (leavesOpenOrClosed && !ticket.assigneeId) t.state.assigneeId = input.staffId;
  if (ticket.status === 'closed' && target === 'closed') {
    // A reply with Close on a Ticket closed within the window: it stays closed, closed again now.
    t.state.closedAt = ctx.now;
    t.state.closedBy = 'staff';
  } else {
    t.moveTo(target, 'staff', input.staffId);
  }

  t.state.waitingSince = null;
  t.state.firstStaffReplyAt ??= ctx.now;
  t.state.lastMessageAt = ctx.now;
  t.state.lastMessageBy = 'staff';
  t.events.push(
    target === 'closed'
      ? { type: 'TicketClosed', messageId: reply.id, closedBy: 'staff' }
      : { type: 'StaffReplied', messageId: reply.id },
  );
  t.facts.push({
    type: 'staff_replied',
    messageId: reply.id,
    isFirstStaffReply: isFirst,
    businessMinutesToFirstReply: isFirst ? businessMinutesBetween(ticket.createdAt, ctx.now) : null,
  });
  return t.finish();
}

/** FR-10: an Internal note. Changes nothing else: no status, no `waitingSince`, no email. */
export function addNote(
  ticket: Ticket,
  input: { staffId: string; text: string },
  ctx: TicketContext,
): TicketChange {
  const body = plainText(input.text, TEXT_MIN, TEXT_MAX, 'note');
  const t = new Transition(ticket, ctx);
  const note = t.message('internal_note', input.staffId, body);
  t.facts.push({ type: 'note_added', messageId: note.id });
  return t.finish();
}

/**
 * FR-8 Take it: assignee = the Staff Member; `open` and `waiting_on_customer` → `in_progress`.
 * 409 TICKET_CLOSED on a closed Ticket. Check the version first with `assertVersion`.
 */
export function take(ticket: Ticket, input: { staffId: string }, ctx: TicketContext): TicketChange {
  if (ticket.status === 'closed') throw supportErrors.ticketClosed();
  const t = new Transition(ticket, ctx);
  if (ticket.assigneeId !== input.staffId) {
    t.message('event', input.staffId, null, { type: 'taken' });
    t.facts.push({ type: 'taken', previousAssigneeId: ticket.assigneeId });
    t.state.assigneeId = input.staffId;
  }
  t.moveTo('in_progress', 'staff', input.staffId);
  return t.finish();
}

/**
 * FR-8 Assign: any Staff Member, or nobody (null, back to the Waiting queue). Status unchanged.
 * Whether `assigneeId` is a Staff Member (404 UNKNOWN_STAFF) is the use case's check.
 */
export function assign(
  ticket: Ticket,
  input: { staffId: string; assigneeId: string | null },
  ctx: TicketContext,
): TicketChange {
  const t = new Transition(ticket, ctx);
  if (ticket.assigneeId !== input.assigneeId) {
    t.message('event', input.staffId, null, { type: 'assigned', assigneeId: input.assigneeId });
    t.facts.push({
      type: 'assigned',
      assigneeId: input.assigneeId,
      previousAssigneeId: ticket.assigneeId,
    });
    t.state.assigneeId = input.assigneeId;
  }
  return t.finish();
}

/**
 * FR-9 Status select: any of the four. `closed` = Close (`TicketClosed`, closedBy staff); another
 * status on a closed Ticket reopens it within the window (else 409 TICKET_CLOSED_TOO_LONG).
 */
export function setStatus(
  ticket: Ticket,
  input: { staffId: string; status: TicketStatus },
  ctx: TicketContext,
): TicketChange {
  if (ticket.status === 'closed' && input.status !== 'closed') assertCanReopen(ticket, ctx.now);
  const t = new Transition(ticket, ctx);
  t.moveTo(input.status, 'staff', input.staffId);
  if (input.status === 'closed' && ticket.status !== 'closed') {
    t.events.push({ type: 'TicketClosed', messageId: null, closedBy: 'staff' });
  }
  return t.finish();
}

/**
 * FR-7: the assignee opening the Staff ticket view reads the customer replies (`waitingSince`
 * cleared). Anyone else, or an unassigned Ticket, changes nothing.
 */
export function markReadByAssignee(
  ticket: Ticket,
  input: { staffId: string },
  ctx: TicketContext,
): TicketChange {
  const t = new Transition(ticket, ctx);
  if (ticket.assigneeId === input.staffId && ticket.waitingSince !== null) {
    t.state.waitingSince = null;
    t.facts.push({ type: 'marked_read' });
  }
  return t.finish();
}

// Outbox ------------------------------------------------------------------------------------------

/** What every support outbox event carries (mirrors ports.ts TicketEventBase). */
export interface TicketEventIds {
  ticketId: string;
  ticketNumber: number;
  businessId: string;
  openedByMemberId: string;
  assigneeId: string | null;
}

/** support's outbox event payloads (structurally ports.ts SupportOutboxEvents). */
export interface TicketOutboxEvents {
  TicketOpened: TicketEventIds & { messageId: string };
  CustomerReplied: TicketEventIds & { messageId: string };
  StaffReplied: TicketEventIds & { messageId: string };
  TicketClosed: TicketEventIds & { messageId: string | null; closedBy: TicketSide };
}

export type TicketOutboxMessage = {
  [K in keyof TicketOutboxEvents]: { type: K; payload: TicketOutboxEvents[K] };
}[keyof TicketOutboxEvents];

/** The events of a change as outbox messages, with the Ticket's ids (after the change). */
export function outboxEvents(
  ticket: Ticket,
  events: readonly TicketEvent[],
): TicketOutboxMessage[] {
  const ids: TicketEventIds = {
    ticketId: ticket.id,
    ticketNumber: ticket.number,
    businessId: ticket.businessId,
    openedByMemberId: ticket.openedByMemberId,
    assigneeId: ticket.assigneeId,
  };
  return events.map((event): TicketOutboxMessage => {
    switch (event.type) {
      case 'TicketClosed':
        return {
          type: event.type,
          payload: { ...ids, messageId: event.messageId, closedBy: event.closedBy },
        };
      default:
        return { type: event.type, payload: { ...ids, messageId: event.messageId } };
    }
  });
}
