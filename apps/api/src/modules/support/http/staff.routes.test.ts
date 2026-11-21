import { errorResponse } from '@app/contracts/errors';
import {
  addInternalNote,
  assignTicket,
  getStaffTicket,
  getWaitingCount,
  listStaffTickets,
  listSupportStaff,
  setTicketStatus,
  staffReplyToTicket,
  takeTicket,
  versionConflictError,
} from '@app/contracts/support';
import { describe, expect, test } from 'vitest';
import { buildTestApp } from '../../../../test/build-test-app.js';
import type { Actor } from '../../../shared/domain/actor.js';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import { createStaffSupport } from '../application/staff/index.js';
import type {
  BillingForSupport,
  IdentityForSupport,
  ResearchForSupport,
  SupportAudit,
  SupportAuditRecord,
} from '../ports.js';
import {
  actors,
  aTicket,
  BUSINESS_A,
  BUSINESS_B,
  FRIDAY,
  INTERNAL_BUSINESS,
  members,
  NOW,
  RUN_ID,
  ticketIn,
} from '../test/factories.js';
import { InMemorySupportStore } from '../test/in-memory-support.js';
import type { Ticket, TicketMessage } from '../domain/index.js';
import { staffSupportRoutes } from './staff.routes.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const staff1 = members.staff1;
const staff2 = members.staff2;

const staffActor: Actor = {
  memberId: staff1.id,
  businessId: INTERNAL_BUSINESS,
  roles: ['owner', 'staff'],
  emailVerified: true,
};

class RecordingAudit implements SupportAudit {
  readonly entries: SupportAuditRecord[] = [];
  record(entry: SupportAuditRecord): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
  get actions(): string[] {
    return this.entries.map((e) => e.action);
  }
}

const identity: IdentityForSupport = {
  memberSummaries: (ids) =>
    Promise.resolve(Object.values(members).filter((m) => ids.includes(m.id))),
  staffMembers: () =>
    Promise.resolve([staff1, staff2].map(({ id, name, email }) => ({ id, name, email }))),
  staffRecipients: () => Promise.resolve([]),
  businessNames: (ids) =>
    Promise.resolve(
      [
        { id: BUSINESS_A, name: 'Sweet Supply' },
        { id: BUSINESS_B, name: 'Clean Desk' },
      ].filter((b) => ids.includes(b.id)),
    ),
};

const research: ResearchForSupport = {
  recentRunsForBusiness: () => Promise.resolve([]),
  runForSupport: (runId) =>
    Promise.resolve(
      runId === RUN_ID
        ? {
            id: RUN_ID,
            planId: '00000000-0000-4000-8000-0000000000e1',
            planName: 'Local buyers',
            startedAt: '2026-11-20T10:00:00.000Z',
            status: 'failed',
            stoppedStep: { number: 5, name: 'Websites' },
            creditsCharged: 12,
            businessId: BUSINESS_A,
            attempt: 2,
            lastError: 'Timeout reading site',
          }
        : null,
    ),
};

const billing: BillingForSupport = { balanceFor: () => Promise.resolve(80) };

async function world(at: Date = NOW, actor?: Actor) {
  const store = new InMemorySupportStore();
  const audit = new RecordingAudit();
  const clock = new FixedClock(at);
  const analytics = new RecordingAnalyticsTracker();
  const ucWith = createStaffSupport({
    store,
    identity,
    research,
    billing,
    audit,
    analytics,
    clock,
    ids: new SequentialIdGenerator(),
  });
  const app = await buildTestApp({
    modules: [{ name: 'support', register: (a) => staffSupportRoutes(ucWith)(a) }],
    ...(actor ? { actor } : {}),
  });
  return { app, store, audit, analytics, clock };
}

type World = Awaited<ReturnType<typeof world>>;
const staffApp = (at: Date = NOW) => world(at, staffActor);
const code = (res: { json(): unknown }) => errorResponse.parse(res.json()).error.code;

function seed(w: { store: InMemorySupportStore }, ticket: Ticket, messages: TicketMessage[] = []) {
  w.store.tickets.seed(ticket, messages);
}

const customerReply = (
  ticket: Ticket,
  n: number,
  body = 'It stopped at step 5.',
): TicketMessage => ({
  id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
  ticketId: ticket.id,
  kind: 'customer_reply',
  authorMemberId: ticket.openedByMemberId,
  body,
  event: null,
  emailed: false,
  createdAt: ticket.createdAt,
});

const ROUTES = [
  { method: 'GET' as const, url: '/api/staff/support/tickets' },
  { method: 'GET' as const, url: '/api/staff/support/count' },
  { method: 'GET' as const, url: '/api/staff/support/staff' },
  { method: 'GET' as const, url: '/api/staff/support/tickets/1001' },
  { method: 'POST' as const, url: '/api/staff/support/tickets/1001/take', payload: { version: 0 } },
  {
    method: 'POST' as const,
    url: '/api/staff/support/tickets/1001/assign',
    payload: { version: 0, assigneeId: null },
  },
  {
    method: 'POST' as const,
    url: '/api/staff/support/tickets/1001/status',
    payload: { version: 0, status: 'closed' },
  },
  {
    method: 'POST' as const,
    url: '/api/staff/support/tickets/1001/replies',
    payload: { message: 'Hello' },
  },
  {
    method: 'POST' as const,
    url: '/api/staff/support/tickets/1001/notes',
    payload: { note: 'Looked at it' },
  },
];

describe('FR-12: every Staff support endpoint is Staff only', () => {
  test.each(ROUTES)(
    '$method $url: 401 signed out, 403 for Members, nothing written',
    async (route) => {
      const out = await world();
      seed(out, aTicket({ number: 1001 }));
      expect((await out.app.inject(route)).statusCode).toBe(401);
      for (const actor of [actors.ownerA, actors.memberA]) {
        const w = await world(NOW, actor);
        seed(w, aTicket({ number: 1001 }));
        const res = await w.app.inject(route);
        expect(res.statusCode).toBe(403);
        expect(code(res)).toBe('FORBIDDEN');
        expect(w.audit.entries).toEqual([]);
        expect(w.store.published).toEqual([]);
      }
    },
  );

  test('Staff Acting as a Business still use the desk', async () => {
    const w = await world(NOW, actors.staffActingAsA);
    const res = await w.app.inject({ method: 'GET', url: '/api/staff/support/count' });
    expect(res.statusCode).toBe(200);
  });

  test.each(ROUTES.slice(3))('$method $url: 404 for an unknown Ticket', async (route) => {
    const w = await staffApp();
    const res = await w.app.inject({ ...route, url: route.url.replace('1001', '4242') });
    expect(res.statusCode).toBe(404);
    expect(code(res)).toBe('TICKET_NOT_FOUND');
  });
});

describe('FR-6: Support desk and the Waiting queue', () => {
  test('both waiting Tickets are listed, the older wait first, and the badge shows 2', async () => {
    const w = await staffApp();
    const unassigned = aTicket({
      number: 1001,
      createdAt: new Date(NOW.getTime() - 2 * HOUR),
      waitingSince: new Date(NOW.getTime() - 2 * HOUR),
    });
    const replied = ticketIn('in_progress', {
      number: 1002,
      waitingSince: new Date(NOW.getTime() - 52 * MIN),
      lastMessageAt: new Date(NOW.getTime() - 52 * MIN),
      lastMessageBy: 'customer',
    });
    const read = ticketIn('in_progress', { number: 1003 });
    for (const t of [replied, read, unassigned]) seed(w, t);

    const res = await w.app.inject({ method: 'GET', url: '/api/staff/support/tickets' });
    const body = listStaffTickets.response.parse(res.json());
    expect(body.items.map((i) => i.number)).toEqual([1001, 1002]);
    expect(body.items[0]).toMatchObject({
      waitMinutes: 120,
      business: { name: 'Sweet Supply' },
      assignee: null,
      openedBy: { name: 'Jo Kim' },
      unreadCustomerReply: true,
    });
    expect(body.items[1]).toMatchObject({ waitMinutes: 52, assignee: { name: 'Sam Staff' } });
    expect(body.counts).toEqual({ waiting: 2, mine: 2, waitingOnCustomer: 0 });
    expect(body.stats).toMatchObject({ waiting: 2, longestWaitMinutes: 120 });

    const count = await w.app.inject({ method: 'GET', url: '/api/staff/support/count' });
    expect(getWaitingCount.response.parse(count.json())).toEqual({ waiting: 2 });
  });

  test('an assigned Ticket whose reply was read is in Mine, not Waiting; assignee filters resolve me and nobody', async () => {
    const w = await staffApp();
    seed(w, ticketIn('in_progress', { number: 1001, createdAt: new Date(NOW.getTime() - HOUR) }));
    seed(w, aTicket({ number: 1002 }));
    const list = async (q: string) =>
      listStaffTickets.response.parse(
        (await w.app.inject({ method: 'GET', url: `/api/staff/support/tickets?${q}` })).json(),
      );
    expect((await list('view=waiting')).items.map((i) => i.number)).toEqual([1002]);
    expect((await list('view=mine')).items.map((i) => i.number)).toEqual([1001]);
    expect((await list('view=all&assignee=me')).items.map((i) => i.number)).toEqual([1001]);
    expect((await list('view=all&assignee=nobody')).items.map((i) => i.number)).toEqual([1002]);
    expect((await list(`view=all&assignee=${staff2.id}`)).items).toEqual([]);
    expect((await list('view=all&category=bug')).items).toEqual([]);
    expect((await list('view=all&limit=1')).nextCursor).not.toBeNull();
    expect(
      (await w.app.inject({ method: 'GET', url: '/api/staff/support/tickets?view=nope' }))
        .statusCode,
    ).toBe(400);
  });

  test('the median first reply is 1 h 30 m for replies after 30, 90 and 600 business minutes', async () => {
    const w = await staffApp();
    const monday = new Date('2026-11-23T17:00:00.000Z');
    [30 * MIN, 90 * MIN, null].forEach((after, i) => {
      const created = FRIDAY;
      seed(
        w,
        ticketIn('in_progress', {
          number: 1001 + i,
          createdAt: created,
          firstStaffReplyAt: after === null ? monday : new Date(created.getTime() + after),
        }),
      );
    });
    const res = await w.app.inject({ method: 'GET', url: '/api/staff/support/tickets?view=all' });
    expect(listStaffTickets.response.parse(res.json()).stats).toMatchObject({
      firstReplyMedianBusinessMinutes30d: 90,
      closedWithin3DaysPct30d: 0,
    });
  });

  test('stats are null when nothing was opened in 30 days; support_desk_viewed is tracked', async () => {
    const w = await staffApp();
    const res = await w.app.inject({ method: 'GET', url: '/api/staff/support/tickets' });
    expect(listStaffTickets.response.parse(res.json()).stats).toEqual({
      waiting: 0,
      longestWaitMinutes: null,
      firstReplyMedianBusinessMinutes30d: null,
      closedWithin3DaysPct30d: null,
    });
    expect(w.analytics.events).toEqual([
      {
        name: 'support_desk_viewed',
        actor: { memberId: staff1.id, businessId: null },
        properties: { view: 'waiting', waiting_count: 0 },
      },
    ]);
  });

  test('the assignee picker lists every Staff Member', async () => {
    const w = await staffApp();
    const res = await w.app.inject({ method: 'GET', url: '/api/staff/support/staff' });
    expect(listSupportStaff.response.parse(res.json()).items.map((s) => s.name)).toEqual([
      'Sam Staff',
      'Lee Staff',
    ]);
  });
});

describe('FR-7: Staff ticket view', () => {
  const linked = () =>
    aTicket({ number: 1001, runId: RUN_ID, pagePath: '/app/runs/1', balanceAtOpen: 120 });

  test('shows the run, context, notes, events and who wrote what', async () => {
    const w = await staffApp();
    const t = linked();
    const at = (m: number) => new Date(t.createdAt.getTime() + m * MIN);
    seed(w, { ...t, firstStaffReplyAt: at(50) }, [
      customerReply(t, 1),
      {
        ...customerReply(t, 2, 'Checking'),
        kind: 'staff_reply',
        authorMemberId: staff1.id,
        createdAt: at(50),
      },
      {
        ...customerReply(t, 3, 'Internal'),
        kind: 'internal_note',
        authorMemberId: staff2.id,
        createdAt: at(51),
      },
      {
        ...customerReply(t, 4),
        kind: 'event',
        body: null,
        authorMemberId: staff1.id,
        event: { type: 'assigned', assigneeId: staff2.id },
        createdAt: at(52),
      },
    ]);
    const res = await w.app.inject({ method: 'GET', url: '/api/staff/support/tickets/1001' });
    expect(res.statusCode).toBe(200);
    const d = getStaffTicket.response.parse(res.json());
    expect(d.messages.map((m) => m.kind)).toEqual([
      'customer_reply',
      'staff_reply',
      'internal_note',
      'event',
    ]);
    expect(d.messages[1]?.author).toMatchObject({ name: 'Sam Staff', isStaff: true });
    expect(d.messages[3]?.event).toEqual({
      type: 'assigned',
      to: { id: staff2.id, name: 'Lee Staff' },
    });
    expect(d.run).toMatchObject({
      planName: 'Local buyers',
      attempt: 2,
      lastError: 'Timeout reading site',
      stoppedStep: { number: 5, name: 'Websites' },
      creditsCharged: 12,
    });
    expect(d.context).toEqual({
      pagePath: '/app/runs/1',
      balanceAtOpen: 120,
      balanceNow: 80,
      openedByRole: 'member',
      businessOpenTickets: 1,
    });
    expect(d.businessMinutesToFirstReply).toBe(0);
    expect(d.firstStaffReplyAt).not.toBeNull();
    expect(d.reopenUntil).toBeNull();
  });

  test('a closed Ticket shows reopenUntil', async () => {
    const w = await staffApp();
    seed(w, ticketIn('closed', { number: 1001, closedDaysAgo: 1 }));
    const d = getStaffTicket.response.parse(
      (await w.app.inject({ method: 'GET', url: '/api/staff/support/tickets/1001' })).json(),
    );
    expect(d.reopenUntil).toBe(new Date(NOW.getTime() + 29 * 24 * HOUR).toISOString());
  });

  test('the assignee opening it reads the customer replies; others change nothing', async () => {
    const w = await staffApp();
    const mine = ticketIn('in_progress', {
      number: 1001,
      waitingSince: new Date(NOW.getTime() - HOUR),
    });
    const theirs = ticketIn('in_progress', {
      number: 1002,
      assigneeId: staff2.id,
      waitingSince: new Date(NOW.getTime() - HOUR),
    });
    const unassigned = aTicket({ number: 1003 });
    for (const t of [mine, theirs, unassigned]) seed(w, t);
    const open = async (n: number) =>
      getStaffTicket.response.parse(
        (
          await w.app.inject({ method: 'GET', url: `/api/staff/support/tickets/${String(n)}` })
        ).json(),
      );
    expect(await open(1001)).toMatchObject({ waitingSince: null, unreadCustomerReply: false });
    expect((await open(1002)).waitingSince).not.toBeNull();
    expect((await open(1003)).waitingSince).not.toBeNull();
    const waiting = await w.app.inject({ method: 'GET', url: '/api/staff/support/count' });
    expect(getWaitingCount.response.parse(waiting.json()).waiting).toBe(2);
  });

  test('support.ticket_viewed is recorded once per Staff Member, Ticket and Chicago day', async () => {
    const w = await staffApp();
    seed(w, aTicket({ number: 1001 }));
    const open = () => w.app.inject({ method: 'GET', url: '/api/staff/support/tickets/1001' });
    await open();
    await open();
    expect(w.audit.actions).toEqual(['support.ticket_viewed']);
    expect(w.audit.entries[0]).toMatchObject({
      staffMemberId: staff1.id,
      businessId: BUSINESS_A,
      targetType: 'support_ticket',
      details: { ticketNumber: 1001 },
    });
    w.clock.set(new Date(NOW.getTime() + 24 * HOUR));
    await open();
    expect(w.audit.actions).toEqual(['support.ticket_viewed', 'support.ticket_viewed']);
  });
});

describe('FR-8: take and assign', () => {
  test('taking an open Ticket makes it in progress and assigned, audited, with no email', async () => {
    const w = await staffApp();
    seed(w, aTicket({ number: 1001 }));
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/staff/support/tickets/1001/take',
      payload: { version: 0 },
    });
    expect(res.statusCode).toBe(200);
    const d = takeTicket.response.parse(res.json());
    expect(d).toMatchObject({
      status: 'in_progress',
      assignee: { id: staff1.id },
      version: 1,
      waitingSince: null,
    });
    expect(d.messages.map((m) => m.event?.type)).toEqual(['taken', 'status_changed']);
    expect(w.audit.actions).toEqual(['support.taken']);
    expect(w.audit.entries[0]?.details).toMatchObject({ ticketNumber: 1001 });
    expect(w.store.published).toEqual([]);
    expect(w.analytics.events.map((e) => e.name)).toEqual(['ticket_status_changed']);
    expect(w.analytics.events[0]?.properties).toEqual({
      ticket_number: 1001,
      from: 'open',
      to: 'in_progress',
      by: 'staff',
    });
  });

  test('two Staff with the same version: the second gets 409 with the Ticket now assigned to the first', async () => {
    const w = await staffApp();
    seed(w, aTicket({ number: 1001, version: 3 }));
    const take = () =>
      w.app.inject({
        method: 'POST',
        url: '/api/staff/support/tickets/1001/take',
        payload: { version: 3 },
      });
    await take();
    const second = await take();
    expect(second.statusCode).toBe(409);
    const body = versionConflictError.parse(second.json());
    expect(body.error.details.ticket).toMatchObject({ version: 4, assignee: { id: staff1.id } });
    expect(w.audit.actions).toEqual(['support.taken']);
  });

  test('a stale take by another Staff Member returns the first one as assignee', async () => {
    const first = await staffApp();
    seed(first, aTicket({ number: 1001, version: 3 }));
    await first.app.inject({
      method: 'POST',
      url: '/api/staff/support/tickets/1001/take',
      payload: { version: 3 },
    });
    const res = await first.app.inject({
      method: 'POST',
      url: '/api/staff/support/tickets/1001/assign',
      payload: { version: 3, assigneeId: staff2.id },
    });
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe('VERSION_CONFLICT');
    expect(versionConflictError.parse(res.json()).error.details.ticket.assignee?.id).toBe(
      staff1.id,
    );
  });

  test('a closed Ticket cannot be taken', async () => {
    const w = await staffApp();
    const closed = ticketIn('closed', { number: 1001 });
    seed(w, closed);
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/staff/support/tickets/1001/take',
      payload: { version: closed.version },
    });
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe('TICKET_CLOSED');
  });

  test('taking a Ticket with an unread reply marks it read (the taker is looking at it)', async () => {
    const w = await staffApp();
    seed(w, ticketIn('in_progress', { number: 1001, waitingSince: NOW }));
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/staff/support/tickets/1001/take',
      payload: { version: 2 },
    });
    expect(takeTicket.response.parse(res.json()).waitingSince).toBeNull();
  });

  test('assign sets any Staff Member or nobody, audited with from and to; unknown Staff is 404', async () => {
    const w = await staffApp();
    seed(w, aTicket({ number: 1001 }));
    const assign = (version: number, assigneeId: string | null) =>
      w.app.inject({
        method: 'POST',
        url: '/api/staff/support/tickets/1001/assign',
        payload: { version, assigneeId },
      });
    const a = assignTicket.response.parse((await assign(0, staff2.id)).json());
    expect(a).toMatchObject({ assignee: { name: 'Lee Staff' }, status: 'open', version: 1 });
    const b = assignTicket.response.parse((await assign(1, null)).json());
    expect(b).toMatchObject({ assignee: null, version: 2 });
    const unknown = await assign(2, members.ownerA.id);
    expect(unknown.statusCode).toBe(404);
    expect(code(unknown)).toBe('UNKNOWN_STAFF');
    expect(w.audit.entries.map((e) => [e.action, e.details])).toEqual([
      ['support.assigned', { ticketNumber: 1001, from: null, to: staff2.id }],
      ['support.assigned', { ticketNumber: 1001, from: staff2.id, to: null }],
    ]);
  });
});

describe('FR-9: status, reply, reply and wait, close', () => {
  const post = (w: World, path: string, payload: object) =>
    w.app.inject({ method: 'POST', url: `/api/staff/support/tickets/1001/${path}`, payload });

  test('a status select audits support.status_changed with from and to', async () => {
    const w = await staffApp();
    seed(w, aTicket({ number: 1001 }));
    const res = await post(w, 'status', { version: 0, status: 'waiting_on_customer' });
    expect(setTicketStatus.response.parse(res.json()).status).toBe('waiting_on_customer');
    expect(w.audit.entries.map((e) => [e.action, e.details])).toEqual([
      ['support.status_changed', { ticketNumber: 1001, from: 'open', to: 'waiting_on_customer' }],
    ]);
  });

  test('closing via status: one TicketClosed, support.closed, ticket_closed analytics', async () => {
    const w = await staffApp();
    const t = ticketIn('in_progress', { number: 1001 });
    seed(w, t, [customerReply(t, 1)]);
    const res = await post(w, 'status', { version: t.version, status: 'closed' });
    const d = setTicketStatus.response.parse(res.json());
    expect(d).toMatchObject({ status: 'closed', closedAt: NOW.toISOString() });
    expect(d.reopenUntil).toBe(new Date(NOW.getTime() + 30 * 24 * HOUR).toISOString());
    expect(w.audit.actions).toEqual(['support.closed']);
    expect(w.store.published.map((e) => e.type)).toEqual(['TicketClosed']);
    expect(w.store.published[0]?.payload).toMatchObject({ closedBy: 'staff', messageId: null });
    const closed = w.analytics.events.find((e) => e.name === 'ticket_closed');
    expect(closed?.properties).toMatchObject({
      ticket_number: 1001,
      by: 'staff',
      staff_replies: 0,
      customer_replies: 1,
    });
  });

  test('another status on a closed Ticket within the window reopens it; after 30 days 409', async () => {
    const w = await staffApp();
    const t = ticketIn('closed', { number: 1001, closedDaysAgo: 10 });
    seed(w, t);
    const res = await post(w, 'status', { version: t.version, status: 'in_progress' });
    expect(setTicketStatus.response.parse(res.json())).toMatchObject({
      status: 'in_progress',
      closedAt: null,
    });
    expect(w.audit.actions).toEqual(['support.reopened']);
    const reopened = w.analytics.events.find((e) => e.name === 'ticket_reopened');
    expect(reopened?.properties).toEqual({
      ticket_number: 1001,
      by: 'staff',
      days_since_closed: 10,
    });

    const late = await staffApp();
    const old = ticketIn('closed', { number: 1001, closedDaysAgo: 31 });
    seed(late, old);
    const tooLong = await post(late, 'status', { version: old.version, status: 'open' });
    expect(tooLong.statusCode).toBe(409);
    expect(code(tooLong)).toBe('TICKET_CLOSED_TOO_LONG');
  });

  test('a stale status change answers 409 with the current Ticket', async () => {
    const w = await staffApp();
    seed(w, aTicket({ number: 1001, version: 5 }));
    const res = await post(w, 'status', { version: 4, status: 'closed' });
    expect(res.statusCode).toBe(409);
    expect(versionConflictError.parse(res.json()).error.details.ticket.version).toBe(5);
    expect(w.audit.entries).toEqual([]);
  });

  test('a reply on an open Ticket makes it in progress, assigns the replier and clears the wait', async () => {
    const w = await staffApp();
    seed(w, aTicket({ number: 1001 }));
    const res = await post(w, 'replies', { message: 'On it.' });
    expect(res.statusCode).toBe(201);
    const d = staffReplyToTicket.response.parse(res.json());
    expect(d).toMatchObject({
      status: 'in_progress',
      assignee: { id: staff1.id },
      waitingSince: null,
      preview: { author: 'support', authorName: 'Llyner Leads Support', text: 'On it.' },
    });
    expect(d.messages.find((m) => m.kind === 'staff_reply')).toMatchObject({ body: 'On it.' });
    expect(w.audit.entries.map((e) => [e.action, e.details])).toEqual([
      ['support.replied', { ticketNumber: 1001, waitOnCustomer: false }],
    ]);
    expect(w.store.published.map((e) => e.type)).toEqual(['StaffReplied']);
  });

  test('the first reply 50 business minutes after opening is tracked with that figure', async () => {
    const w = await staffApp(new Date(FRIDAY.getTime() + 50 * MIN));
    seed(w, aTicket({ number: 1001, createdAt: FRIDAY, waitingSince: FRIDAY }));
    await post(w, 'replies', { message: 'Hello' });
    const replied = w.analytics.events.find((e) => e.name === 'ticket_replied');
    expect(replied?.properties).toEqual({
      ticket_number: 1001,
      by: 'staff',
      minutes_since_last: 50,
      is_first_staff_reply: true,
      business_minutes_to_first_reply: 50,
    });
    await post(w, 'replies', { message: 'Again' });
    const second = w.analytics.events.filter((e) => e.name === 'ticket_replied')[1];
    expect(second?.properties).toMatchObject({ is_first_staff_reply: false });
    expect(second?.properties).not.toHaveProperty('business_minutes_to_first_reply');
  });

  test('Reply and wait: status Waiting on customer, one StaffReplied, audit waitOnCustomer', async () => {
    const w = await staffApp();
    const t = ticketIn('in_progress', { number: 1001 });
    seed(w, t);
    const res = await post(w, 'replies', { message: 'Which step?', then: 'wait_on_customer' });
    expect(staffReplyToTicket.response.parse(res.json()).status).toBe('waiting_on_customer');
    expect(w.store.published.map((e) => e.type)).toEqual(['StaffReplied']);
    expect(w.audit.entries[0]?.details).toEqual({ ticketNumber: 1001, waitOnCustomer: true });
  });

  test('Close with a reply: the reply is added, the Ticket closes, one TicketClosed carries the reply', async () => {
    const w = await staffApp();
    seed(w, ticketIn('in_progress', { number: 1001 }));
    const res = await post(w, 'replies', { message: 'All fixed.', then: 'close' });
    const d = staffReplyToTicket.response.parse(res.json());
    expect(d.status).toBe('closed');
    const reply = d.messages.find((m) => m.kind === 'staff_reply');
    expect(w.store.published).toHaveLength(1);
    expect(w.store.published[0]).toMatchObject({
      type: 'TicketClosed',
      payload: { messageId: reply?.id, closedBy: 'staff' },
    });
    expect(w.audit.actions).toEqual(['support.replied', 'support.closed']);
    expect(w.analytics.events.map((e) => e.name)).toEqual(
      expect.arrayContaining(['ticket_replied', 'ticket_status_changed', 'ticket_closed']),
    );
  });

  test('a reply on a closed Ticket within 30 days reopens it; after that 409', async () => {
    const w = await staffApp();
    seed(w, ticketIn('closed', { number: 1001, closedDaysAgo: 5 }));
    const res = await post(w, 'replies', { message: 'One more thing.' });
    expect(staffReplyToTicket.response.parse(res.json()).status).toBe('in_progress');
    expect(w.audit.actions).toEqual(['support.replied', 'support.reopened']);
    expect(w.analytics.events.some((e) => e.name === 'ticket_reopened')).toBe(true);

    const late = await staffApp();
    seed(late, ticketIn('closed', { number: 1001, closedDaysAgo: 40 }));
    const tooLong = await post(late, 'replies', { message: 'Too late.' });
    expect(tooLong.statusCode).toBe(409);
    expect(code(tooLong)).toBe('TICKET_CLOSED_TOO_LONG');
    expect(late.audit.entries).toEqual([]);
  });

  test('empty and overlong replies are 400', async () => {
    const w = await staffApp();
    seed(w, aTicket({ number: 1001 }));
    expect((await post(w, 'replies', { message: '   ' })).statusCode).toBe(400);
    expect((await post(w, 'replies', { message: 'x'.repeat(10_001) })).statusCode).toBe(400);
    expect((await post(w, 'replies', { message: 'ok', then: 'nope' })).statusCode).toBe(400);
  });
});

describe('FR-10: internal notes', () => {
  test('a note is Staff only: no status change, no email, no first reply, audited', async () => {
    const w = await staffApp();
    seed(w, aTicket({ number: 1001 }));
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/staff/support/tickets/1001/notes',
      payload: { note: 'Probably the proxy.' },
    });
    expect(res.statusCode).toBe(201);
    const d = addInternalNote.response.parse(res.json());
    expect(d.messages.at(-1)).toMatchObject({
      kind: 'internal_note',
      body: 'Probably the proxy.',
      author: { name: 'Sam Staff' },
    });
    expect(d).toMatchObject({
      status: 'open',
      firstStaffReplyAt: null,
      version: 0,
      preview: null,
    });
    expect(d.waitingSince).not.toBeNull();
    expect(w.store.published).toEqual([]);
    expect(w.audit.entries.map((e) => [e.action, e.details])).toEqual([
      ['support.note_added', { ticketNumber: 1001 }],
    ]);
    expect(w.analytics.events).toEqual([]);
  });

  test('an empty note is 400', async () => {
    const w = await staffApp();
    seed(w, aTicket({ number: 1001 }));
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/staff/support/tickets/1001/notes',
      payload: { note: '' },
    });
    expect(res.statusCode).toBe(400);
  });
});
