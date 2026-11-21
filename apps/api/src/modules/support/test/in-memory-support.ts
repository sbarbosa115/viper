import { FIRST_TICKET_NUMBER } from '@app/contracts/support';
import { supportErrors } from '../domain/errors.js';
import {
  customerOrder,
  inCustomerFilter,
  inStaffView,
  matchesStaffFilters,
  pageOf,
  previewText,
  staffOrder,
  type CustomerListQuery,
  type CustomerTicketPage,
  type StaffCounts,
  type StaffListQuery,
  type StaffTicketPage,
  type TicketListItem,
  type TicketPreview,
  type TicketTimes,
  type WaitingSummary,
} from '../domain/listing.js';
import type { SupportStore, SupportTx, TicketRepository } from '../domain/repository.js';
import { canSee, isWaiting, waitStart, type WindowUsage } from '../domain/rules.js';
import {
  withNumber,
  type OpenedTicket,
  type Ticket,
  type TicketChange,
  type TicketMessage,
  type TicketOutboxMessage,
} from '../domain/ticket.js';

/**
 * In-memory `SupportStore` for fast application tests (customer, Staff and email packages).
 *
 * Same behaviour as `KyselySupportStore` (both pass ticket-repository-contract.ts): numbers from
 * 1001, versioned saves (409 VERSION_CONFLICT), the list orderings, counts and previews. `run`
 * is atomic: a throw restores the Tickets, messages and views and drops the events it published.
 * Not modelled: concurrency (locks are no-ops) and SQL collation.
 *
 * ```ts
 * const store = new InMemorySupportStore();
 * store.tickets.seed(ticketIn('closed'));   // or create through openTicket + store.run
 * ... run the use case ...
 * expect(store.published).toEqual([{ type: 'StaffReplied', payload: { ... } }]);
 * expect(store.tickets.messagesOf(ticket.id)) ...
 * ```
 */
export class InMemoryTicketRepository implements TicketRepository {
  private tickets = new Map<string, Ticket>();
  private allMessages: TicketMessage[] = [];
  private views = new Map<string, Date>();
  private nextNumber = FIRST_TICKET_NUMBER;

  /** Puts a Ticket (and its messages) in place without a transition. */
  seed(ticket: Ticket, messages: readonly TicketMessage[] = []): void {
    this.tickets.set(ticket.id, ticket);
    this.allMessages.push(...messages);
    this.nextNumber = Math.max(this.nextNumber, ticket.number + 1);
  }

  /** Every stored Ticket, by number. */
  all(): Ticket[] {
    return [...this.tickets.values()].sort((a, b) => a.number - b.number);
  }

  /** @internal Snapshot for `InMemorySupportStore.run`'s rollback. */
  snapshot(): () => void {
    const tickets = new Map(this.tickets);
    const messages = [...this.allMessages];
    const views = new Map(this.views);
    const nextNumber = this.nextNumber;
    return () => {
      this.tickets = tickets;
      this.allMessages = messages;
      this.views = views;
      this.nextNumber = nextNumber;
    };
  }

  create(opened: OpenedTicket): Promise<Ticket> {
    const ticket = withNumber(opened.ticket, this.nextNumber++);
    this.tickets.set(ticket.id, ticket);
    this.allMessages.push(...opened.messages);
    return Promise.resolve(ticket);
  }

  findByNumber(number: number): Promise<Ticket | null> {
    return Promise.resolve(this.all().find((t) => t.number === number) ?? null);
  }

  findById(id: string): Promise<Ticket | null> {
    return Promise.resolve(this.tickets.get(id) ?? null);
  }

  saveChange(change: TicketChange): Promise<void> {
    if (change.changed) {
      const current = this.tickets.get(change.ticket.id);
      if (current?.version !== change.expectedVersion) {
        return Promise.reject(supportErrors.versionConflict(change.ticket.number));
      }
      this.tickets.set(change.ticket.id, change.ticket);
    }
    this.allMessages.push(...change.messages);
    return Promise.resolve();
  }

  messages(ticketId: string): Promise<TicketMessage[]> {
    return Promise.resolve(this.messagesOf(ticketId));
  }

  /** The thread, oldest first (synchronous, for assertions). */
  messagesOf(ticketId: string): TicketMessage[] {
    return this.allMessages
      .filter((m) => m.ticketId === ticketId)
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
  }

  findMessage(messageId: string): Promise<TicketMessage | null> {
    return Promise.resolve(this.allMessages.find((m) => m.id === messageId) ?? null);
  }

  markEmailed(messageId: string): Promise<void> {
    this.allMessages = this.allMessages.map((m) =>
      m.id === messageId ? { ...m, emailed: true } : m,
    );
    return Promise.resolve();
  }

  lockOpenTicketsOfBusiness(businessId: string): Promise<number> {
    return this.countOpenOfBusiness(businessId);
  }

  countOpenOfBusiness(businessId: string): Promise<number> {
    return Promise.resolve(
      this.all().filter((t) => t.businessId === businessId && t.status !== 'closed').length,
    );
  }

  ticketsOpenedBy(memberId: string, since: Date): Promise<WindowUsage> {
    return Promise.resolve(
      usage(
        this.all()
          .filter((t) => t.openedByMemberId === memberId && t.createdAt >= since)
          .map((t) => t.createdAt),
      ),
    );
  }

  customerRepliesBy(memberId: string, since: Date): Promise<WindowUsage> {
    return Promise.resolve(
      usage(
        this.allMessages
          .filter(
            (m) =>
              m.kind === 'customer_reply' && m.authorMemberId === memberId && m.createdAt >= since,
          )
          .map((m) => m.createdAt),
      ),
    );
  }

  findDuplicate(input: {
    memberId: string;
    subject: string;
    message: string;
    since: Date;
  }): Promise<Ticket | null> {
    const subject = input.subject.trim();
    const message = input.message.trim();
    const match = this.all()
      .filter(
        (t) =>
          t.openedByMemberId === input.memberId &&
          t.createdAt >= input.since &&
          t.subject === subject &&
          this.messagesOf(t.id)[0]?.body === message,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return Promise.resolve(match[0] ?? null);
  }

  listForCustomer(query: CustomerListQuery): Promise<CustomerTicketPage> {
    const visible = this.all().filter((t) => canSee(query.viewer, t));
    const page = pageOf(
      visible.filter((t) => inCustomerFilter(query.filter, t)),
      customerOrder(query.filter),
      (t) => t,
      query.cursor,
      query.limit,
    );
    return Promise.resolve({
      items: page.rows.map((t) => this.item(t)),
      counts: {
        open: visible.filter((t) => t.status !== 'closed').length,
        closed: visible.filter((t) => t.status === 'closed').length,
      },
      nextCursor: page.nextCursor,
    });
  }

  listForStaff(query: StaffListQuery): Promise<StaffTicketPage> {
    const page = pageOf(
      this.all().filter((t) => matchesStaffFilters(query, t)),
      staffOrder(query.view),
      (t) => t,
      query.cursor,
      query.limit,
    );
    return Promise.resolve({
      items: page.rows.map((t) => this.item(t)),
      nextCursor: page.nextCursor,
    });
  }

  private item(ticket: Ticket): TicketListItem {
    const last = this.messagesOf(ticket.id)
      .filter((m) => m.kind === 'customer_reply' || m.kind === 'staff_reply')
      .at(-1);
    const lastReply: TicketPreview | null = last
      ? {
          side: last.kind === 'staff_reply' ? 'staff' : 'customer',
          authorMemberId: last.authorMemberId,
          text: previewText([...(last.body ?? '')].slice(0, 80).join('')),
        }
      : null;
    return { ticket, lastReply };
  }

  staffCounts(staffId: string): Promise<StaffCounts> {
    const all = this.all();
    return Promise.resolve({
      waiting: all.filter((t) => inStaffView('waiting', t, staffId)).length,
      mine: all.filter((t) => inStaffView('mine', t, staffId)).length,
      waitingOnCustomer: all.filter((t) => inStaffView('waiting_on_customer', t, staffId)).length,
    });
  }

  waitingSummary(): Promise<WaitingSummary> {
    const starts = this.all()
      .filter(isWaiting)
      .map((t) => waitStart(t).getTime());
    return Promise.resolve({
      count: starts.length,
      oldestStart: starts.length > 0 ? new Date(Math.min(...starts)) : null,
    });
  }

  ticketTimesSince(since: Date): Promise<TicketTimes[]> {
    return Promise.resolve(
      this.all()
        .filter((t) => t.createdAt >= since)
        .map((t) => ({
          createdAt: t.createdAt,
          firstStaffReplyAt: t.firstStaffReplyAt,
          closedAt: t.closedAt,
        })),
    );
  }

  recordView(
    ticketId: string,
    memberId: string,
    at: Date,
  ): Promise<{ previousViewAt: Date | null }> {
    const key = `${ticketId}/${memberId}`;
    const previousViewAt = this.views.get(key) ?? null;
    this.views.set(key, at);
    return Promise.resolve({ previousViewAt });
  }
}

function usage(times: Date[]): WindowUsage {
  const ms = times.map((t) => t.getTime());
  return { count: ms.length, oldest: ms.length > 0 ? new Date(Math.min(...ms)) : null };
}

export class InMemorySupportStore implements SupportStore {
  readonly tickets = new InMemoryTicketRepository();
  readonly read: TicketRepository = this.tickets;
  /** Outbox events of committed runs, in order. */
  readonly published: TicketOutboxMessage[] = [];

  async run<T>(fn: (tx: SupportTx) => Promise<T>): Promise<T> {
    const rollback = this.tickets.snapshot();
    const pending: TicketOutboxMessage[] = [];
    const tx: SupportTx = {
      tickets: this.tickets,
      events: {
        publish: (type, payload) => {
          pending.push({ type, payload } as TicketOutboxMessage);
          return Promise.resolve();
        },
      },
      handle: {},
    };
    try {
      const result = await fn(tx);
      this.published.push(...pending);
      return result;
    } catch (error) {
      rollback();
      throw error;
    }
  }
}
