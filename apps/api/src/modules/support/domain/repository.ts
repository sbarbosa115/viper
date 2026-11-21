import type {
  CustomerListQuery,
  CustomerTicketPage,
  StaffCounts,
  StaffListQuery,
  StaffTicketPage,
  TicketTimes,
  WaitingSummary,
} from './listing.js';
import type { WindowUsage } from './rules.js';
import type {
  OpenedTicket,
  Ticket,
  TicketChange,
  TicketMessage,
  TicketOutboxEvents,
} from './ticket.js';

/**
 * support's persistence ports. Implemented by `KyselySupportStore` (infrastructure) and
 * `InMemorySupportStore` (test kit); both pass test/ticket-repository-contract.ts.
 *
 * How a use case writes (one transaction per command):
 * ```ts
 * await store.run(async (tx) => {
 *   const ticket = await tx.tickets.findByNumber(n, { forUpdate: true });   // replies, notes, views
 *   const change = staffReply(ticket, input, ctx);
 *   await tx.tickets.saveChange(change);                                      // 409 VERSION_CONFLICT if stale
 *   for (const e of outboxEvents(change.ticket, change.events)) await tx.events.publish(e.type, e.payload);
 *   await audit.record(entry, tx.handle);
 * });
 * ```
 */
export interface TicketRepository {
  /** Inserts the Ticket and its first messages; returns it with its AUTO_INCREMENT number. */
  create(opened: OpenedTicket): Promise<Ticket>;

  /**
   * One Ticket by number. `forUpdate` locks the row until the transaction ends: use it for the
   * unversioned commands (replies, notes, the assignee's view) so their save never conflicts.
   */
  findByNumber(number: number, options?: { forUpdate?: boolean }): Promise<Ticket | null>;
  /** One Ticket by id (the email consumer gets ids from the outbox event). */
  findById(id: string): Promise<Ticket | null>;

  /**
   * Writes a change: updates the row `WHERE id = ? AND version = expectedVersion` when
   * `changed` (none affected → 409 VERSION_CONFLICT), then appends its messages.
   */
  saveChange(change: TicketChange): Promise<void>;

  /** The thread, oldest first (`created_at`, then id). Customer endpoints must drop notes and take/assign events. */
  messages(ticketId: string): Promise<TicketMessage[]>;
  /** One message (the email consumer). */
  findMessage(messageId: string): Promise<TicketMessage | null>;
  /** The email consumer sent this Staff reply to the opener. */
  markEmailed(messageId: string): Promise<void>;

  /**
   * Counts the Business's Tickets not closed and locks them (FOR UPDATE) until the transaction
   * ends, so two concurrent creates can't both pass the 5-open limit. Call it inside `run`.
   */
  lockOpenTicketsOfBusiness(businessId: string): Promise<number>;
  /** Tickets not closed of a Business (the Staff side panel); no lock. */
  countOpenOfBusiness(businessId: string): Promise<number>;

  /** New Tickets the Member opened since `since` (10 per hour). */
  ticketsOpenedBy(memberId: string, since: Date): Promise<WindowUsage>;
  /** Customer replies the Member wrote since `since`, across Tickets, first messages included (30 per hour). */
  customerRepliesBy(memberId: string, since: Date): Promise<WindowUsage>;
  /** A Ticket the Member opened since `since` with this subject and first message (trimmed), or null. */
  findDuplicate(input: {
    memberId: string;
    subject: string;
    message: string;
    since: Date;
  }): Promise<Ticket | null>;

  /** FR-1: the viewer's visible Tickets, counts and the last reply of each row. */
  listForCustomer(query: CustomerListQuery): Promise<CustomerTicketPage>;
  /** FR-6: one view of the Support desk, with filters. */
  listForStaff(query: StaffListQuery): Promise<StaffTicketPage>;
  /** FR-6: the view chips' counts for this Staff Member. */
  staffCounts(staffId: string): Promise<StaffCounts>;
  /** FR-6: the Waiting queue's size (the nav badge) and its oldest wait start. */
  waitingSummary(): Promise<WaitingSummary>;
  /** FR-6: the times of Tickets opened at or after `since` (feed `supportStats`). */
  ticketTimesSince(since: Date): Promise<TicketTimes[]>;

  /**
   * Records that a Member viewed the Ticket at `at` (support_ticket_views upsert) and returns the
   * previous view, for the once-per-day `support.ticket_viewed` audit (`isFirstViewOfDay`).
   */
  recordView(
    ticketId: string,
    memberId: string,
    at: Date,
  ): Promise<{ previousViewAt: Date | null }>;
}

/** Publishes support's outbox events in the open transaction (structurally SupportEventPublisher). */
export interface TicketEventPublisher {
  publish<K extends keyof TicketOutboxEvents>(
    type: K,
    payload: TicketOutboxEvents[K],
  ): Promise<void>;
}

/** What a unit of work gives the use case. */
export interface SupportTx {
  readonly tickets: TicketRepository;
  readonly events: TicketEventPublisher;
  /** The transaction handle, for `SupportAudit.record(entry, tx.handle)`. */
  readonly handle: object;
}

export interface SupportStore {
  /**
   * One transaction: the Ticket, its messages and outbox events commit together or not at all.
   * The Kysely store retries `fn` (up to 3 times) after a MySQL deadlock, which two concurrent
   * creates for one Business can cause; keep `fn` free of side effects outside `tx`.
   */
  run<T>(fn: (tx: SupportTx) => Promise<T>): Promise<T>;
  /** Reads outside a transaction (lists, counts, the thread). */
  readonly read: TicketRepository;
}
