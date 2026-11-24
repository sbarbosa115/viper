import { beforeEach, describe, expect, test } from 'vitest';
import { CodedError } from '../../../shared/domain/errors.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { statsSince, supportStats } from '../domain/listing.js';
import type { SupportStore } from '../domain/repository.js';
import {
  assertVersion,
  assign,
  customerClose,
  customerReply,
  markReadByAssignee,
  addNote,
  openTicket,
  outboxEvents,
  setStatus,
  staffReply,
  take,
  type OpenTicketInput,
  type Ticket,
  type TicketChange,
  type TicketContext,
} from '../domain/ticket.js';
import { BUSINESS_A, BUSINESS_B, FRIDAY, members, NOW, openInput, viewers } from './factories.js';

/**
 * The behaviour every `SupportStore` must have, run against `KyselySupportStore`
 * (infrastructure/kysely-support.int.test.ts) and `InMemorySupportStore`
 * (test/in-memory-support.test.ts), so application tests on the fake hold on MySQL.
 */
export interface ContractWorld {
  readonly store: SupportStore;
  /** Outbox events committed so far, oldest first. */
  published(): Promise<{ type: string; payload: unknown }[]>;
}

const MIN = 60_000;
const ago = (min: number) => new Date(NOW.getTime() - min * MIN);
const ids = new Uuid7Generator();
const ctxAt = (at: Date): TicketContext => ({ now: at, ids });

export async function openAt(
  store: SupportStore,
  at: Date,
  overrides: Partial<OpenTicketInput> = {},
): Promise<Ticket> {
  const opened = openTicket(openInput({ id: ids.next(), ...overrides }), ctxAt(at));
  return store.run(async (tx) => {
    const ticket = await tx.tickets.create(opened);
    for (const e of outboxEvents(ticket, opened.events)) await tx.events.publish(e.type, e.payload);
    return ticket;
  });
}

export async function applyAt(
  store: SupportStore,
  ticket: Pick<Ticket, 'number'>,
  at: Date,
  command: (t: Ticket, ctx: TicketContext) => TicketChange,
): Promise<TicketChange> {
  return store.run(async (tx) => {
    const current = await tx.tickets.findByNumber(ticket.number, { forUpdate: true });
    if (!current) throw new Error(`no ticket ${String(ticket.number)}`);
    const change = command(current, ctxAt(at));
    await tx.tickets.saveChange(change);
    for (const e of outboxEvents(change.ticket, change.events)) {
      await tx.events.publish(e.type, e.payload);
    }
    return change;
  });
}

const staff1 = members.staff1.id;
const staff2 = members.staff2.id;
const byOwnerA = { openedByMemberId: members.ownerA.id };
const numbers = (items: { ticket: Ticket }[]) => items.map((i) => i.ticket.number);

export function describeTicketRepositoryContract(
  name: string,
  makeWorld: () => Promise<ContractWorld>,
): void {
  describe(`TicketRepository contract: ${name}`, () => {
    let world: ContractWorld;
    let store: SupportStore;
    beforeEach(async () => {
      world = await makeWorld();
      store = world.store;
    });

    test('numbers start at 1001; a Ticket round-trips with its first message', async () => {
      const first = await openAt(store, ago(10));
      const second = await openAt(store, ago(5), { runId: 'c0000000-0000-4000-8000-000000000009' });
      expect([first.number, second.number]).toEqual([1001, 1002]);
      expect(await store.read.findByNumber(1001)).toEqual(first);
      expect(await store.read.findById(second.id)).toEqual(second);
      expect(await store.read.findByNumber(999)).toBeNull();
      const thread = await store.read.messages(first.id);
      expect(thread).toHaveLength(1);
      expect(thread[0]).toMatchObject({
        kind: 'customer_reply',
        authorMemberId: members.memberA.id,
        body: 'It stopped at step 3 and charged me.',
        event: null,
        emailed: false,
      });
    });

    test('opening publishes TicketOpened in the same transaction', async () => {
      const t = await openAt(store, ago(10));
      const [message] = await store.read.messages(t.id);
      expect(await world.published()).toEqual([
        {
          type: 'TicketOpened',
          payload: {
            ticketId: t.id,
            ticketNumber: 1001,
            businessId: BUSINESS_A,
            openedByMemberId: members.memberA.id,
            assigneeId: null,
            messageId: message?.id,
          },
        },
      ]);
    });

    test('a failed unit of work leaves no Ticket, message or event', async () => {
      await expect(
        store.run(async (tx) => {
          const opened = openTicket(openInput({ id: ids.next() }), ctxAt(ago(1)));
          const t = await tx.tickets.create(opened);
          for (const e of outboxEvents(t, opened.events))
            await tx.events.publish(e.type, e.payload);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await store.read.waitingSummary()).toEqual({ count: 0, oldestStart: null });
      expect(await world.published()).toEqual([]);
    });

    test('saveChange writes the row and messages in order; a stale version is VERSION_CONFLICT', async () => {
      const t = await openAt(store, ago(30));
      const taken = await applyAt(store, t, ago(20), (cur, ctx) =>
        take(cur, { staffId: staff1 }, ctx),
      );
      const stored = await store.read.findByNumber(t.number);
      expect(stored).toEqual(taken.ticket);
      expect(stored).toMatchObject({ version: 1, status: 'in_progress', assigneeId: staff1 });

      const stale = take(t, { staffId: staff2 }, ctxAt(ago(19)));
      await expect(store.run((tx) => tx.tickets.saveChange(stale))).rejects.toMatchObject({
        code: 'VERSION_CONFLICT',
      });

      const thread = await store.read.messages(t.id);
      expect(thread.map((m) => m.event ?? m.kind)).toEqual([
        'customer_reply',
        { type: 'taken' },
        { type: 'status_changed', from: 'open', to: 'in_progress' },
      ]);
      expect(thread.map((m) => m.authorMemberId)).toEqual([members.memberA.id, staff1, staff1]);
    });

    test('the assignee viewing keeps the version: another Staff status change at it succeeds', async () => {
      const t = await openAt(store, ago(30));
      await applyAt(store, t, ago(25), (cur, ctx) => take(cur, { staffId: staff1 }, ctx));
      const readByB = await store.read.findByNumber(t.number);
      await applyAt(store, t, ago(20), (cur, ctx) =>
        customerReply(cur, { memberId: members.memberA.id, text: 'More' }, ctx),
      );
      await applyAt(store, t, ago(15), (cur, ctx) =>
        markReadByAssignee(cur, { staffId: staff1 }, ctx),
      );
      const viewed = await store.read.findByNumber(t.number);
      expect(viewed).toMatchObject({ waitingSince: null, version: readByB?.version });

      await store.run(async (tx) => {
        const current = await tx.tickets.findByNumber(t.number);
        if (!current || !readByB) throw new Error('missing');
        assertVersion(current, readByB.version);
        await tx.tickets.saveChange(
          setStatus(current, { staffId: staff2, status: 'waiting_on_customer' }, ctxAt(ago(10))),
        );
      });
      expect(await store.read.findByNumber(t.number)).toMatchObject({
        status: 'waiting_on_customer',
        version: (readByB?.version ?? 0) + 1,
      });
    });

    test('an Internal note appends a message and leaves the row untouched', async () => {
      const t = await openAt(store, ago(30));
      await applyAt(store, t, ago(10), (cur, ctx) =>
        addNote(cur, { staffId: staff1, text: 'Checked' }, ctx),
      );
      expect(await store.read.findByNumber(t.number)).toEqual(t);
      const thread = await store.read.messages(t.id);
      expect(thread.at(-1)).toMatchObject({
        kind: 'internal_note',
        body: 'Checked',
        authorMemberId: staff1,
      });
    });

    test('assigned events round-trip, including nobody', async () => {
      const t = await openAt(store, ago(30));
      await applyAt(store, t, ago(20), (cur, ctx) => take(cur, { staffId: staff1 }, ctx));
      await applyAt(store, t, ago(10), (cur, ctx) =>
        assign(cur, { staffId: staff1, assigneeId: null }, ctx),
      );
      const thread = await store.read.messages(t.id);
      expect(thread.at(-1)?.event).toEqual({ type: 'assigned', assigneeId: null });
      expect((await store.read.findByNumber(t.number))?.assigneeId).toBeNull();
    });

    test('messages: find one and mark a Staff reply emailed', async () => {
      const t = await openAt(store, ago(30));
      const change = await applyAt(store, t, ago(10), (cur, ctx) =>
        staffReply(cur, { staffId: staff1, text: 'Fixed' }, ctx),
      );
      const replyId = change.messages[0]?.id ?? '';
      expect(await store.read.findMessage(replyId)).toMatchObject({
        kind: 'staff_reply',
        emailed: false,
      });
      await store.run((tx) => tx.tickets.markEmailed(replyId));
      expect(await store.read.findMessage(replyId)).toMatchObject({ emailed: true });
      expect(await store.read.findMessage('00000000-0000-4000-8000-000000000000')).toBeNull();
    });

    test('open Tickets of a Business count only those not closed', async () => {
      await openAt(store, ago(30));
      const closing = await openAt(store, ago(29));
      await openAt(store, ago(28), byOwnerA);
      await openAt(store, ago(27), { businessId: BUSINESS_B, openedByMemberId: members.ownerB.id });
      await applyAt(store, closing, ago(20), (cur, ctx) =>
        customerClose(cur, { memberId: members.memberA.id }, ctx),
      );
      expect(await store.read.countOpenOfBusiness(BUSINESS_A)).toBe(2);
      expect(await store.run((tx) => tx.tickets.lockOpenTicketsOfBusiness(BUSINESS_A))).toBe(2);
      expect(await store.read.countOpenOfBusiness(BUSINESS_B)).toBe(1);
    });

    test('rate-limit windows: Tickets opened and customer replies per Member', async () => {
      const old = await openAt(store, ago(70));
      await openAt(store, ago(50));
      const recent = await openAt(store, ago(10));
      await openAt(store, ago(5), byOwnerA);
      await applyAt(store, old, ago(40), (cur, ctx) =>
        customerReply(cur, { memberId: members.memberA.id, text: 'More' }, ctx),
      );
      await applyAt(store, recent, ago(8), (cur, ctx) =>
        staffReply(cur, { staffId: staff1, text: 'Hi' }, ctx),
      );
      expect(await store.read.ticketsOpenedBy(members.memberA.id, ago(60))).toEqual({
        count: 2,
        oldest: ago(50),
      });
      // Two first messages and one reply in the window; the Staff reply doesn't count.
      expect(await store.read.customerRepliesBy(members.memberA.id, ago(60))).toEqual({
        count: 3,
        oldest: ago(50),
      });
      expect(await store.read.ticketsOpenedBy(members.ownerB.id, ago(60))).toEqual({
        count: 0,
        oldest: null,
      });
    });

    test('duplicates: same Member, subject and message within the window', async () => {
      const t = await openAt(store, ago(0.5), {
        subject: 'Same subject',
        message: 'Same message here',
      });
      const query = {
        memberId: members.memberA.id,
        subject: ' Same subject ',
        message: 'Same message here ',
        since: ago(1),
      };
      expect((await store.read.findDuplicate(query))?.number).toBe(t.number);
      expect(await store.read.findDuplicate({ ...query, message: 'Same message HERE' })).toBeNull();
      expect(await store.read.findDuplicate({ ...query, since: ago(0.25) })).toBeNull();
      expect(await store.read.findDuplicate({ ...query, memberId: members.ownerA.id })).toBeNull();
    });

    test('FR-1: customer list per visibility, filter and order, with counts and previews', async () => {
      const t1 = await openAt(store, ago(300));
      const t2 = await openAt(store, ago(200), byOwnerA);
      const t3 = await openAt(store, ago(400));
      const t4 = await openAt(store, ago(100), {
        businessId: BUSINESS_B,
        openedByMemberId: members.ownerB.id,
      });
      await applyAt(store, t1, ago(50), (cur, ctx) =>
        staffReply(cur, { staffId: staff1, text: `Thanks! ${'x'.repeat(100)}` }, ctx),
      );
      await applyAt(store, t1, ago(40), (cur, ctx) =>
        addNote(cur, { staffId: staff1, text: 'note' }, ctx),
      );
      await applyAt(store, t3, ago(30), (cur, ctx) =>
        customerClose(cur, { memberId: members.memberA.id }, ctx),
      );

      const mine = await store.read.listForCustomer({
        viewer: viewers.memberA,
        filter: 'open',
        cursor: null,
        limit: 25,
      });
      expect(numbers(mine.items)).toEqual([t1.number]);
      expect(mine.counts).toEqual({ open: 1, closed: 1 });
      expect(mine.items[0]?.lastReply).toEqual({
        side: 'staff',
        authorMemberId: staff1,
        text: `Thanks! ${'x'.repeat(72)}`,
      });

      const owner = await store.read.listForCustomer({
        viewer: viewers.ownerA,
        filter: 'all',
        cursor: null,
        limit: 25,
      });
      // Not closed by lastMessageAt desc (t1 replied 50 min ago, t2 opened 200 min ago), then closed.
      expect(numbers(owner.items)).toEqual([t1.number, t2.number, t3.number]);
      expect(owner.counts).toEqual({ open: 2, closed: 1 });
      expect(owner.items[1]?.lastReply).toMatchObject({
        side: 'customer',
        authorMemberId: members.ownerA.id,
      });

      const closed = await store.read.listForCustomer({
        viewer: viewers.ownerA,
        filter: 'closed',
        cursor: null,
        limit: 25,
      });
      expect(numbers(closed.items)).toEqual([t3.number]);

      const page1 = await store.read.listForCustomer({
        viewer: viewers.ownerA,
        filter: 'all',
        cursor: null,
        limit: 2,
      });
      expect(numbers(page1.items)).toEqual([t1.number, t2.number]);
      const page2 = await store.read.listForCustomer({
        viewer: viewers.ownerA,
        filter: 'all',
        cursor: page1.nextCursor,
        limit: 2,
      });
      expect(numbers(page2.items)).toEqual([t3.number]);
      expect(page2.nextCursor).toBeNull();

      const other = await store.read.listForCustomer({
        viewer: viewers.ownerB,
        filter: 'all',
        cursor: null,
        limit: 25,
      });
      expect(numbers(other.items)).toEqual([t4.number]);
    });

    describe('FR-6: Support desk', () => {
      /**
       * U: open, unassigned, opened 2 h ago. R: assigned to staff1, customer reply 52 min ago.
       * M: assigned to staff1, the customer reply read by the assignee. W: waiting on customer.
       * C: closed. All in Business A except W (B).
       */
      async function desk() {
        const r = await openAt(store, ago(300), { category: 'billing' });
        await applyAt(store, r, ago(240), (cur, ctx) =>
          staffReply(cur, { staffId: staff1, text: 'Hi' }, ctx),
        );
        await applyAt(store, r, ago(52), (cur, ctx) =>
          customerReply(cur, { memberId: members.memberA.id, text: 'Still broken' }, ctx),
        );
        const m = await openAt(store, ago(250), byOwnerA);
        await applyAt(store, m, ago(200), (cur, ctx) => take(cur, { staffId: staff1 }, ctx));
        await applyAt(store, m, ago(30), (cur, ctx) =>
          customerReply(cur, { memberId: members.ownerA.id, text: 'Answer' }, ctx),
        );
        await applyAt(store, m, ago(20), (cur, ctx) =>
          markReadByAssignee(cur, { staffId: staff1 }, ctx),
        );
        const u = await openAt(store, ago(120));
        const w = await openAt(store, ago(500), {
          businessId: BUSINESS_B,
          openedByMemberId: members.ownerB.id,
        });
        await applyAt(store, w, ago(100), (cur, ctx) =>
          staffReply(cur, { staffId: staff2, text: 'Which run?', then: 'wait_on_customer' }, ctx),
        );
        const c = await openAt(store, ago(600));
        await applyAt(store, c, ago(10), (cur, ctx) =>
          staffReply(cur, { staffId: staff2, text: 'Done', then: 'close' }, ctx),
        );
        return { r, m, u, w, c };
      }
      const list = (
        view: 'waiting' | 'mine' | 'waiting_on_customer' | 'closed' | 'all',
        extra = {},
      ) => store.read.listForStaff({ view, staffId: staff1, cursor: null, limit: 25, ...extra });

      test('Waiting: the unassigned 2 h one, then the unread reply of 52 min; not the read one', async () => {
        const { r, m, u } = await desk();
        const waiting = await list('waiting');
        expect(numbers(waiting.items)).toEqual([u.number, r.number]);
        expect(numbers((await list('mine')).items)).toEqual([m.number, r.number]);
        expect(await store.read.staffCounts(staff1)).toEqual({
          waiting: 2,
          mine: 2,
          waitingOnCustomer: 1,
        });
        expect(await store.read.staffCounts(staff2)).toMatchObject({ mine: 1 });
        expect(await store.read.waitingSummary()).toEqual({ count: 2, oldestStart: ago(120) });
      });

      test('the other views, their orders and filters', async () => {
        const { r, m, u, w, c } = await desk();
        expect(numbers((await list('waiting_on_customer')).items)).toEqual([w.number]);
        expect(numbers((await list('closed')).items)).toEqual([c.number]);
        expect(numbers((await list('all')).items)).toEqual([
          u.number,
          m.number,
          r.number,
          w.number,
          c.number,
        ]);
        expect(numbers((await list('all', { assigneeId: null })).items)).toEqual([u.number]);
        expect(numbers((await list('all', { assigneeId: staff2 })).items)).toEqual([
          w.number,
          c.number,
        ]);
        expect(numbers((await list('waiting', { category: 'billing' })).items)).toEqual([r.number]);
        expect(numbers((await list('waiting', { assigneeId: staff1 })).items)).toEqual([r.number]);
        expect((await list('waiting')).items[1]?.lastReply).toMatchObject({
          side: 'customer',
          text: 'Still broken',
        });

        const page1 = await list('all', { limit: 2 });
        const page2 = await list('all', { limit: 2, cursor: page1.nextCursor });
        const page3 = await list('all', { limit: 2, cursor: page2.nextCursor });
        expect([...numbers(page1.items), ...numbers(page2.items), ...numbers(page3.items)]).toEqual(
          [u.number, m.number, r.number, w.number, c.number],
        );
        expect(page3.nextCursor).toBeNull();
      });

      test('first replies after 30, 90 and 600 business minutes → median 90', async () => {
        const plus = (min: number) => new Date(FRIDAY.getTime() + min * MIN);
        const replyAt = [plus(30), plus(90), new Date('2026-11-23T17:00:00Z')];
        for (const at of replyAt) {
          const t = await openAt(store, FRIDAY);
          await applyAt(store, t, at, (cur, ctx) =>
            staffReply(cur, { staffId: staff1, text: 'Hi' }, ctx),
          );
        }
        await openAt(store, new Date(statsSince(NOW).getTime() - MIN));
        const recent = await store.read.ticketTimesSince(statsSince(NOW));
        expect(recent).toHaveLength(3);
        const stats = supportStats({
          waiting: await store.read.waitingSummary(),
          recent,
          now: NOW,
        });
        expect(stats.firstReplyMedianBusinessMinutes30d).toBe(90);
      });
    });

    test('views: the previous view is returned and replaced', async () => {
      const t = await openAt(store, ago(30));
      expect(await store.run((tx) => tx.tickets.recordView(t.id, staff1, ago(20)))).toEqual({
        previousViewAt: null,
      });
      expect(await store.run((tx) => tx.tickets.recordView(t.id, staff1, ago(10)))).toEqual({
        previousViewAt: ago(20),
      });
      expect(await store.run((tx) => tx.tickets.recordView(t.id, staff2, ago(5)))).toEqual({
        previousViewAt: null,
      });
    });

    test('codes reach the caller as CodedError', async () => {
      const t = await openAt(store, ago(30));
      const stale = take(t, { staffId: staff1 }, ctxAt(ago(1)));
      await store.run((tx) => tx.tickets.saveChange(stale));
      const error = await store.run((tx) => tx.tickets.saveChange(stale)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CodedError);
    });
  });
}
