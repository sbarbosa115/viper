import {
  sql,
  type Expression,
  type Kysely,
  type RawBuilder,
  type Selectable,
  type SqlBool,
  type Transaction,
} from 'kysely';
import type { DB } from '../../../shared/infrastructure/db/schema.js';
import type { Outbox, OutboxEvents } from '../../../shared/infrastructure/outbox/index.js';
import { supportErrors } from '../domain/errors.js';
import {
  decodeCursor,
  encodeCursor,
  previewText,
  type CustomerListQuery,
  type CustomerTicketPage,
  type SortDirection,
  type SortKey,
  type StaffCounts,
  type StaffListQuery,
  type StaffTicketPage,
  type TicketListItem,
  type TicketPreview,
  type TicketTimes,
  type WaitingSummary,
} from '../domain/listing.js';
import type { SupportStore, SupportTx, TicketRepository } from '../domain/repository.js';
import type { WindowUsage } from '../domain/rules.js';
import {
  withNumber,
  type OpenedTicket,
  type Ticket,
  type TicketChange,
  type TicketMessage,
  type TicketMessageEvent,
} from '../domain/ticket.js';
import type { SupportEventColumn, SupportMessagesTable, SupportTicketsTable } from './tables.js';

type Db = Kysely<DB> | Transaction<DB>;
type TicketRow = Selectable<SupportTicketsTable>;
type MessageRow = Selectable<SupportMessagesTable>;

const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));
const asDateOrNull = (value: Date | string | null): Date | null =>
  value === null ? null : asDate(value);

function toTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    number: Number(row.number),
    businessId: row.business_id,
    openedByMemberId: row.opened_by_member_id,
    category: row.category,
    subject: row.subject,
    status: row.status,
    assigneeId: row.assignee_member_id,
    runId: row.run_id,
    source: row.source,
    pagePath: row.page_path,
    balanceAtOpen: row.balance_at_open,
    version: Number(row.version),
    waitingSince: asDateOrNull(row.waiting_since),
    firstStaffReplyAt: asDateOrNull(row.first_staff_reply_at),
    lastMessageAt: asDate(row.last_message_at),
    lastMessageBy: row.last_message_by,
    closedAt: asDateOrNull(row.closed_at),
    closedBy: row.closed_by,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

/** The mutable columns of a Ticket (everything an update may write). */
function ticketState(t: Omit<Ticket, 'number'>) {
  return {
    status: t.status,
    assignee_member_id: t.assigneeId,
    version: t.version,
    waiting_since: t.waitingSince,
    first_staff_reply_at: t.firstStaffReplyAt,
    last_message_at: t.lastMessageAt,
    last_message_by: t.lastMessageBy,
    closed_at: t.closedAt,
    closed_by: t.closedBy,
    updated_at: t.updatedAt,
  };
}

function toEventColumn(event: TicketMessageEvent): SupportEventColumn {
  switch (event.type) {
    case 'status_changed':
      return { type: 'status_changed', from: event.from, to: event.to };
    case 'taken':
      return { type: 'taken' };
    case 'assigned':
      return { type: 'assigned', assigneeId: event.assigneeId };
  }
}

function toMessageEvent(column: SupportEventColumn | string | null): TicketMessageEvent | null {
  if (column === null) return null;
  const e = typeof column === 'string' ? (JSON.parse(column) as SupportEventColumn) : column;
  switch (e.type) {
    case 'taken':
      return { type: 'taken' };
    case 'assigned':
      return { type: 'assigned', assigneeId: e.assigneeId ?? null };
    case 'reopened':
      // Not written by this version (a reopen is a status change); read as one for safety.
      return { type: 'status_changed', from: 'closed', to: e.to ?? 'open' };
    case 'status_changed':
      return { type: 'status_changed', from: e.from ?? 'open', to: e.to ?? 'open' };
  }
}

function toMessage(row: MessageRow): TicketMessage {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    kind: row.kind,
    authorMemberId: row.author_member_id,
    body: row.body,
    event: toMessageEvent(row.event),
    emailed: Boolean(row.emailed),
    createdAt: asDate(row.created_at),
  };
}

// Ordering in SQL (mirrors domain/listing.ts customerOrder and staffOrder) --------------------------

interface SqlOrder {
  rank: RawBuilder<number>;
  time: RawBuilder<Date>;
  direction: SortDirection;
}

const closedTime = sql<Date>`COALESCE(closed_at, created_at)`;

function customerSqlOrder(filter: CustomerListQuery['filter']): SqlOrder {
  return {
    rank: filter === 'all' ? sql<number>`IF(status = 'closed', 1, 0)` : sql<number>`0`,
    time: sql<Date>`IF(status = 'closed', COALESCE(closed_at, created_at), last_message_at)`,
    direction: 'desc',
  };
}

function staffSqlOrder(view: StaffListQuery['view']): SqlOrder {
  const zero = sql<number>`0`;
  switch (view) {
    case 'waiting':
      return { rank: zero, time: sql<Date>`COALESCE(waiting_since, created_at)`, direction: 'asc' };
    case 'mine':
      return { rank: zero, time: sql<Date>`last_message_at`, direction: 'desc' };
    case 'waiting_on_customer':
      return { rank: zero, time: sql<Date>`last_message_at`, direction: 'asc' };
    case 'closed':
      return { rank: zero, time: closedTime, direction: 'desc' };
    case 'all':
      return { rank: zero, time: sql<Date>`created_at`, direction: 'desc' };
  }
}

/** Rows strictly after the cursor's key in this order. */
function afterKey(order: SqlOrder, k: SortKey): Expression<SqlBool> {
  const op = sql.raw(order.direction === 'asc' ? '>' : '<');
  return sql<SqlBool>`(${order.rank} > ${k.rank} OR (${order.rank} = ${k.rank} AND (${order.time} ${op} ${k.time} OR (${order.time} = ${k.time} AND number ${op} ${k.number}))))`;
}

const WAITING = sql<SqlBool>`(status IN ('open', 'in_progress') AND (assignee_member_id IS NULL OR waiting_since IS NOT NULL))`;

// The repository ----------------------------------------------------------------------------------

/** support's Ticket storage on MySQL (prd-support section 8). Build one per transaction. */
export class KyselyTicketRepository implements TicketRepository {
  constructor(private readonly db: Db) {}

  async create(opened: OpenedTicket): Promise<Ticket> {
    const t = opened.ticket;
    const result = await this.db
      .insertInto('support_tickets')
      .values({
        id: t.id,
        business_id: t.businessId,
        opened_by_member_id: t.openedByMemberId,
        category: t.category,
        subject: t.subject,
        run_id: t.runId,
        source: t.source,
        page_path: t.pagePath,
        balance_at_open: t.balanceAtOpen,
        created_at: t.createdAt,
        ...ticketState(t),
      })
      .executeTakeFirstOrThrow();
    const ticket = withNumber(t, Number(result.insertId));
    await this.insertMessages(opened.messages);
    return ticket;
  }

  async findByNumber(number: number, options?: { forUpdate?: boolean }): Promise<Ticket | null> {
    let query = this.db.selectFrom('support_tickets').selectAll().where('number', '=', number);
    if (options?.forUpdate) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? toTicket(row) : null;
  }

  async findById(id: string): Promise<Ticket | null> {
    const row = await this.db
      .selectFrom('support_tickets')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toTicket(row) : null;
  }

  async saveChange(change: TicketChange): Promise<void> {
    if (change.changed) {
      const result = await this.db
        .updateTable('support_tickets')
        .set(ticketState(change.ticket))
        .where('id', '=', change.ticket.id)
        .where('version', '=', change.expectedVersion)
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) {
        throw supportErrors.versionConflict(change.ticket.number);
      }
    }
    await this.insertMessages(change.messages);
  }

  private async insertMessages(messages: readonly TicketMessage[]): Promise<void> {
    if (messages.length === 0) return;
    await this.db
      .insertInto('support_messages')
      .values(
        messages.map((m) => ({
          id: m.id,
          ticket_id: m.ticketId,
          kind: m.kind,
          author_member_id: m.authorMemberId,
          body: m.body,
          event: m.event ? JSON.stringify(toEventColumn(m.event)) : null,
          emailed: m.emailed,
          created_at: m.createdAt,
        })),
      )
      .execute();
  }

  async messages(ticketId: string): Promise<TicketMessage[]> {
    const rows = await this.db
      .selectFrom('support_messages')
      .selectAll()
      .where('ticket_id', '=', ticketId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
    return rows.map(toMessage);
  }

  async findMessage(messageId: string): Promise<TicketMessage | null> {
    const row = await this.db
      .selectFrom('support_messages')
      .selectAll()
      .where('id', '=', messageId)
      .executeTakeFirst();
    return row ? toMessage(row) : null;
  }

  async markEmailed(messageId: string): Promise<void> {
    await this.db
      .updateTable('support_messages')
      .set({ emailed: true })
      .where('id', '=', messageId)
      .execute();
  }

  async lockOpenTicketsOfBusiness(businessId: string): Promise<number> {
    // Next-key locks on the (business_id, status, …) index: the rows found stay locked, and the
    // gaps block a concurrent insert of an open Ticket for this Business until commit.
    const rows = await this.db
      .selectFrom('support_tickets')
      .select('id')
      .where('business_id', '=', businessId)
      .where('status', 'in', ['open', 'in_progress', 'waiting_on_customer'])
      .forUpdate()
      .execute();
    return rows.length;
  }

  async countOpenOfBusiness(businessId: string): Promise<number> {
    const row = await this.db
      .selectFrom('support_tickets')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('business_id', '=', businessId)
      .where('status', '!=', 'closed')
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async ticketsOpenedBy(memberId: string, since: Date): Promise<WindowUsage> {
    const row = await this.db
      .selectFrom('support_tickets')
      .select((eb) => [eb.fn.countAll<number>().as('n'), eb.fn.min('created_at').as('oldest')])
      .where('opened_by_member_id', '=', memberId)
      .where('created_at', '>=', since)
      .executeTakeFirstOrThrow();
    return { count: Number(row.n), oldest: asDateOrNull(row.oldest) };
  }

  async customerRepliesBy(memberId: string, since: Date): Promise<WindowUsage> {
    const row = await this.db
      .selectFrom('support_messages')
      .select((eb) => [eb.fn.countAll<number>().as('n'), eb.fn.min('created_at').as('oldest')])
      .where('author_member_id', '=', memberId)
      .where('kind', '=', 'customer_reply')
      .where('created_at', '>=', since)
      .executeTakeFirstOrThrow();
    return { count: Number(row.n), oldest: asDateOrNull(row.oldest) };
  }

  async findDuplicate(input: {
    memberId: string;
    subject: string;
    message: string;
    since: Date;
  }): Promise<Ticket | null> {
    // Exact (binary) comparison: the table collation ignores case and accents.
    const row = await this.db
      .selectFrom('support_tickets as t')
      .innerJoin('support_messages as m', (join) =>
        join
          .onRef('m.ticket_id', '=', 't.id')
          .on('m.kind', '=', 'customer_reply')
          .onRef('m.created_at', '=', 't.created_at'),
      )
      .selectAll('t')
      .where('t.opened_by_member_id', '=', input.memberId)
      .where('t.created_at', '>=', input.since)
      .where(sql<SqlBool>`BINARY t.subject = BINARY ${input.subject.trim()}`)
      .where(sql<SqlBool>`BINARY m.body = BINARY ${input.message.trim()}`)
      .orderBy('t.created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? toTicket(row) : null;
  }

  async listForCustomer(query: CustomerListQuery): Promise<CustomerTicketPage> {
    const { viewer } = query;
    const visible = this.db
      .selectFrom('support_tickets')
      .where('business_id', '=', viewer.businessId)
      .$if(!viewer.isOwner, (q) => q.where('opened_by_member_id', '=', viewer.memberId));

    const counts = await visible
      .select([
        sql<number>`COALESCE(SUM(status <> 'closed'), 0)`.as('open'),
        sql<number>`COALESCE(SUM(status = 'closed'), 0)`.as('closed'),
      ])
      .executeTakeFirstOrThrow();

    const order = customerSqlOrder(query.filter);
    const after = decodeCursor(query.cursor);
    const rows = await visible
      .selectAll()
      .select([order.rank.as('sort_rank'), order.time.as('sort_time')])
      .$if(query.filter === 'open', (q) => q.where('status', '!=', 'closed'))
      .$if(query.filter === 'closed', (q) => q.where('status', '=', 'closed'))
      .where(after ? afterKey(order, after) : sql<SqlBool>`TRUE`)
      .orderBy('sort_rank', 'asc')
      .orderBy('sort_time', order.direction)
      .orderBy('number', order.direction)
      .limit(query.limit + 1)
      .execute();

    return {
      ...(await this.page(rows, query.limit)),
      counts: { open: Number(counts.open), closed: Number(counts.closed) },
    };
  }

  async listForStaff(query: StaffListQuery): Promise<StaffTicketPage> {
    const order = staffSqlOrder(query.view);
    const after = decodeCursor(query.cursor);
    const { view, staffId, category, assigneeId } = query;
    const rows = await this.db
      .selectFrom('support_tickets')
      .selectAll()
      .select([order.rank.as('sort_rank'), order.time.as('sort_time')])
      .$if(view === 'waiting', (q) => q.where(WAITING))
      .$if(view === 'mine', (q) =>
        q.where('assignee_member_id', '=', staffId).where('status', '!=', 'closed'),
      )
      .$if(view === 'waiting_on_customer', (q) => q.where('status', '=', 'waiting_on_customer'))
      .$if(view === 'closed', (q) => q.where('status', '=', 'closed'))
      .$if(category !== undefined, (q) => q.where('category', '=', category ?? 'other'))
      .$if(assigneeId === null, (q) => q.where('assignee_member_id', 'is', null))
      .$if(typeof assigneeId === 'string', (q) =>
        q.where('assignee_member_id', '=', assigneeId ?? ''),
      )
      .where(after ? afterKey(order, after) : sql<SqlBool>`TRUE`)
      .orderBy('sort_rank', 'asc')
      .orderBy('sort_time', order.direction)
      .orderBy('number', order.direction)
      .limit(query.limit + 1)
      .execute();
    return this.page(rows, query.limit);
  }

  /** Cuts the extra row into a cursor and attaches the last reply of each Ticket. */
  private async page(
    rows: (TicketRow & { sort_rank: number; sort_time: Date | string })[],
    limit: number,
  ): Promise<{ items: TicketListItem[]; nextCursor: string | null }> {
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? encodeCursor({
            rank: Number(last.sort_rank),
            time: asDate(last.sort_time),
            number: Number(last.number),
          })
        : null;
    const tickets = pageRows.map(toTicket);
    const previews = await this.lastReplies(tickets.map((t) => t.id));
    return {
      items: tickets.map((ticket) => ({ ticket, lastReply: previews.get(ticket.id) ?? null })),
      nextCursor,
    };
  }

  private async lastReplies(ticketIds: string[]): Promise<Map<string, TicketPreview>> {
    const previews = new Map<string, TicketPreview>();
    if (ticketIds.length === 0) return previews;
    const rows = await this.db
      .selectFrom('support_messages')
      .select(['ticket_id', 'kind', 'author_member_id', sql<string>`LEFT(body, 80)`.as('preview')])
      .where('ticket_id', 'in', ticketIds)
      .where('kind', 'in', ['customer_reply', 'staff_reply'])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    for (const row of rows) {
      if (previews.has(row.ticket_id)) continue;
      previews.set(row.ticket_id, {
        side: row.kind === 'staff_reply' ? 'staff' : 'customer',
        authorMemberId: row.author_member_id,
        text: previewText(row.preview),
      });
    }
    return previews;
  }

  async staffCounts(staffId: string): Promise<StaffCounts> {
    const row = await this.db
      .selectFrom('support_tickets')
      .select([
        sql<number>`COALESCE(SUM(${WAITING}), 0)`.as('waiting'),
        sql<number>`COALESCE(SUM(assignee_member_id = ${staffId}), 0)`.as('mine'),
        sql<number>`COALESCE(SUM(status = 'waiting_on_customer'), 0)`.as('woc'),
      ])
      .where('status', '!=', 'closed')
      .executeTakeFirstOrThrow();
    return {
      waiting: Number(row.waiting),
      mine: Number(row.mine),
      waitingOnCustomer: Number(row.woc),
    };
  }

  async waitingSummary(): Promise<WaitingSummary> {
    const row = await this.db
      .selectFrom('support_tickets')
      .select([
        sql<number>`COUNT(*)`.as('n'),
        sql<Date | string | null>`MIN(COALESCE(waiting_since, created_at))`.as('oldest'),
      ])
      .where(WAITING)
      .executeTakeFirstOrThrow();
    return { count: Number(row.n), oldestStart: asDateOrNull(row.oldest) };
  }

  async ticketTimesSince(since: Date): Promise<TicketTimes[]> {
    const rows = await this.db
      .selectFrom('support_tickets')
      .select(['created_at', 'first_staff_reply_at', 'closed_at'])
      .where('created_at', '>=', since)
      .execute();
    return rows.map((r) => ({
      createdAt: asDate(r.created_at),
      firstStaffReplyAt: asDateOrNull(r.first_staff_reply_at),
      closedAt: asDateOrNull(r.closed_at),
    }));
  }

  async recordView(
    ticketId: string,
    memberId: string,
    at: Date,
  ): Promise<{ previousViewAt: Date | null }> {
    const previous = await this.db
      .selectFrom('support_ticket_views')
      .select('last_viewed_at')
      .where('ticket_id', '=', ticketId)
      .where('member_id', '=', memberId)
      .forUpdate()
      .executeTakeFirst();
    await this.db
      .insertInto('support_ticket_views')
      .values({ ticket_id: ticketId, member_id: memberId, last_viewed_at: at })
      .onDuplicateKeyUpdate({ last_viewed_at: at })
      .execute();
    return { previousViewAt: previous ? asDate(previous.last_viewed_at) : null };
  }
}

// The store ---------------------------------------------------------------------------------------

const MAX_ATTEMPTS = 3;

/** MySQL 1213 ER_LOCK_DEADLOCK: InnoDB rolled the transaction back; it is safe to run again. */
function isDeadlock(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { errno?: unknown; code?: unknown };
  return e.errno === 1213 || e.code === 'ER_LOCK_DEADLOCK';
}

/**
 * support's unit of work on MySQL: one transaction per `run`, with the outbox writes in it (the
 * events are published if and only if the Ticket change commits). A deadlock retries `fn`.
 */
export class KyselySupportStore implements SupportStore {
  readonly read: TicketRepository;

  constructor(
    private readonly db: Kysely<DB>,
    private readonly outbox: Outbox,
  ) {
    this.read = new KyselyTicketRepository(db);
  }

  async run<T>(fn: (tx: SupportTx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.db.transaction().execute((trx) => fn(this.tx(trx)));
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS || !isDeadlock(error)) throw error;
      }
    }
  }

  private tx(trx: Transaction<DB>): SupportTx {
    return {
      tickets: new KyselyTicketRepository(trx),
      // TicketOutboxEvents mirrors the shared OutboxEvents for support's events.
      events: {
        publish: (type, payload) =>
          this.outbox.add(trx, type, payload as OutboxEvents[typeof type]),
      },
      handle: trx,
    };
  }
}
