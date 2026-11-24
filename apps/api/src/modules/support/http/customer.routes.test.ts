import { errorResponse } from '@app/contracts/errors';
import {
  closeTicket,
  customerMessage,
  listSupportRuns,
  listTickets,
  openTicketLimitError,
  replyToTicket,
  ticketClosedTooLongError,
  ticketDetail,
  type RunRef,
} from '@app/contracts/support';
import { describe, expect, test } from 'vitest';
import { buildTestApp } from '../../../../test/build-test-app.js';
import type { Actor } from '../../../shared/domain/actor.js';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import { createCustomerSupport } from '../application/customer/index.js';
import {
  addNote,
  assign,
  openTicket,
  staffReply,
  take,
  type Ticket,
  type TicketChange,
  type TicketMessage,
} from '../domain/index.js';
import { InMemorySupportStore } from '../test/in-memory-support.js';
import {
  actors,
  aTicket,
  BUSINESS_A,
  BUSINESS_B,
  fixedClock,
  members,
  NOW,
  openInput,
  RUN_ID,
  ticketIn,
} from '../test/factories.js';
import type { SupportRun } from '../ports.js';
import { customerSupportRoutes } from './customer.routes.js';

const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;
const OTHER_RUN = 'c0000000-0000-4000-8000-000000000002';
const OLD_RUN = 'c0000000-0000-4000-8000-000000000003';
const SECRET = 'INTERNAL-ONLY: customer is on the watchlist';

const run = (id: string, businessId: string, daysAgo: number): SupportRun => ({
  id,
  planId: 'e0000000-0000-4000-8000-000000000001',
  planName: 'Bakeries near Austin',
  startedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
  status: 'failed',
  stoppedStep: { number: 5, name: 'Websites' },
  creditsCharged: 0,
  businessId,
  attempt: 1,
  lastError: null,
});

async function world(actor?: Actor) {
  const store = new InMemorySupportStore();
  const clock = fixedClock();
  const ids = new SequentialIdGenerator();
  const analytics = new RecordingAnalyticsTracker();
  const runs = [
    run(RUN_ID, BUSINESS_A, 2),
    run(OTHER_RUN, BUSINESS_B, 2),
    run(OLD_RUN, BUSINESS_A, 120),
  ];
  const uc = createCustomerSupport({
    store,
    identity: {
      memberSummaries: (want) =>
        Promise.resolve(Object.values(members).filter((m) => want.includes(m.id))),
    },
    research: {
      recentRunsForBusiness: (businessId, since, limit): Promise<RunRef[]> =>
        Promise.resolve(
          runs
            .filter((r) => r.businessId === businessId && new Date(r.startedAt) >= since)
            .slice(0, limit),
        ),
      runSummaries: (ids) => Promise.resolve(runs.filter((r) => ids.includes(r.id))),
      runForSupport: (id) => Promise.resolve(runs.find((r) => r.id === id) ?? null),
    },
    billing: { balanceFor: () => Promise.resolve(120) },
    analytics,
    clock,
    ids,
  });
  const app = await buildTestApp({
    modules: [{ name: 'support', register: (a) => customerSupportRoutes(a, uc) }],
    deps: { clock, ids, analytics },
    ...(actor ? { actor } : {}),
  });
  return { app, store, analytics, ids };
}

type World = Awaited<ReturnType<typeof world>>;

const code = (res: { json(): unknown }) => errorResponse.parse(res.json()).error.code;
const names = (w: World) => w.analytics.events.map((e) => e.name);
const body = {
  category: 'run',
  subject: 'Run stopped early',
  message: 'It stopped at the Websites step.',
};

/** Stores a Ticket the way a use case would, with Staff activity from the domain commands. */
async function stored(
  w: World,
  apply: (t: Ticket, ctx: { now: Date; ids: SequentialIdGenerator }) => TicketChange[],
) {
  const ctx = { now: new Date(NOW.getTime() - 2 * HOUR), ids: w.ids };
  const opened = openTicket(openInput({ id: w.ids.next(), runId: RUN_ID, source: 'run' }), ctx);
  return w.store.run(async (tx) => {
    let ticket = await tx.tickets.create(opened);
    for (const change of apply(ticket, { ...ctx, now: new Date(ctx.now.getTime() + HOUR) })) {
      await tx.tickets.saveChange(change);
      ticket = change.ticket;
    }
    return ticket;
  });
}

describe('FR-12: authentication', () => {
  test('every customer endpoint answers 401 without a session', async () => {
    const { app } = await world();
    const calls = [
      app.inject({ method: 'GET', url: '/api/support/tickets' }),
      app.inject({ method: 'POST', url: '/api/support/tickets', payload: body }),
      app.inject({ method: 'GET', url: '/api/support/tickets/1001' }),
      app.inject({
        method: 'POST',
        url: '/api/support/tickets/1001/replies',
        payload: { message: 'x' },
      }),
      app.inject({ method: 'POST', url: '/api/support/tickets/1001/close', payload: {} }),
      app.inject({ method: 'GET', url: '/api/support/runs' }),
    ];
    for (const res of await Promise.all(calls)) expect(res.statusCode).toBe(401);
  });
});

describe('FR-2: open a ticket', () => {
  test('creates an open Ticket with the run, balance and page, outbox event and analytics', async () => {
    const w = await world(actors.memberA);
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/support/tickets',
      payload: { ...body, runId: RUN_ID, source: 'run', pagePath: '/app/runs/1' },
    });
    expect(res.statusCode).toBe(201);
    const detail = ticketDetail.parse(res.json());
    expect(detail).toMatchObject({
      number: 1001,
      status: 'open',
      source: 'run',
      canReply: true,
      canClose: true,
      readOnly: false,
      run: {
        id: RUN_ID,
        planName: 'Bakeries near Austin',
        stoppedStep: { number: 5, name: 'Websites' },
      },
      messages: [
        { kind: 'customer_reply', body: body.message, author: { kind: 'member', name: 'Jo Kim' } },
      ],
    });
    const stored = await w.store.read.findByNumber(1001);
    expect(stored).toMatchObject({ balanceAtOpen: 120, pagePath: '/app/runs/1', runId: RUN_ID });
    expect(w.store.published.map((e) => e.type)).toEqual(['TicketOpened']);
    expect(w.analytics.events).toEqual([
      {
        name: 'ticket_opened',
        actor: { memberId: members.memberA.id, businessId: BUSINESS_A },
        properties: {
          ticket_number: 1001,
          business_id: BUSINESS_A,
          category: 'run',
          has_run: true,
          source: 'run',
        },
      },
    ]);
  });

  test('drops a pagePath that is not under /app/', async () => {
    const w = await world(actors.memberA);
    await w.app.inject({
      method: 'POST',
      url: '/api/support/tickets',
      payload: { ...body, pagePath: 'https://evil.test/' },
    });
    expect((await w.store.read.findByNumber(1001))?.pagePath).toBeNull();
  });

  test('a duplicate within 60 seconds returns the existing Ticket with 200', async () => {
    const w = await world(actors.memberA);
    const first = await w.app.inject({
      method: 'POST',
      url: '/api/support/tickets',
      payload: body,
    });
    const again = await w.app.inject({
      method: 'POST',
      url: '/api/support/tickets',
      payload: body,
    });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(again.json<{ number: number }>().number).toBe(1001);
    expect(w.store.tickets.all()).toHaveLength(1);
    expect(names(w)).toEqual(['ticket_opened']);
  });

  test('400 with field errors for a short subject and message', async () => {
    const w = await world(actors.memberA);
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/support/tickets',
      payload: { category: 'run', subject: 'abcd', message: 'too short' },
    });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(errorResponse.parse(res.json()).error.fields ?? {})).toEqual(
      expect.arrayContaining(['subject', 'message']),
    );
    expect(w.store.tickets.all()).toHaveLength(0);
  });

  test('404 UNKNOWN_RUN for another Business run and for one older than 90 days', async () => {
    const w = await world(actors.memberA);
    for (const runId of [OTHER_RUN, OLD_RUN, 'c0000000-0000-4000-8000-0000000000ff']) {
      const res = await w.app.inject({
        method: 'POST',
        url: '/api/support/tickets',
        payload: { ...body, runId },
      });
      expect(res.statusCode).toBe(404);
      expect(code(res)).toBe('UNKNOWN_RUN');
    }
    expect(w.store.tickets.all()).toHaveLength(0);
  });

  test('400 for a subject with a line break', async () => {
    const w = await world(actors.memberA);
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/support/tickets',
      payload: { ...body, subject: 'Run stopped\nearly' },
    });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(errorResponse.parse(res.json()).error.fields ?? {})).toContain('subject');
  });

  test('403 NOT_WHILE_ACTING_AS for Staff', async () => {
    const w = await world(actors.staffActingAsA);
    const res = await w.app.inject({ method: 'POST', url: '/api/support/tickets', payload: body });
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('NOT_WHILE_ACTING_AS');
    expect(w.store.tickets.all()).toHaveLength(0);
  });

  test('422 OPEN_TICKET_LIMIT with details.limit when the Business has 5 not closed', async () => {
    const w = await world(actors.memberA);
    for (let i = 0; i < 5; i += 1)
      w.store.tickets.seed(aTicket({ openedByMemberId: members.ownerA.id }));
    const res = await w.app.inject({ method: 'POST', url: '/api/support/tickets', payload: body });
    expect(res.statusCode).toBe(422);
    expect(openTicketLimitError.parse(res.json()).error.details.limit).toBe(5);
    expect(w.store.tickets.all()).toHaveLength(5);
  });

  test('a closed Ticket does not count towards the limit', async () => {
    const w = await world(actors.memberA);
    for (let i = 0; i < 5; i += 1)
      w.store.tickets.seed(ticketIn('closed', { openedByMemberId: members.ownerA.id }));
    const res = await w.app.inject({ method: 'POST', url: '/api/support/tickets', payload: body });
    expect(res.statusCode).toBe(201);
  });

  test('429 with Retry-After after 10 Tickets in an hour', async () => {
    const w = await world(actors.memberA);
    for (let i = 0; i < 10; i += 1) {
      w.store.tickets.seed(
        ticketIn('closed', { createdAt: new Date(NOW.getTime() - (10 + i) * 60_000) }),
      );
    }
    const res = await w.app.inject({ method: 'POST', url: '/api/support/tickets', payload: body });
    expect(res.statusCode).toBe(429);
    expect(code(res)).toBe('TOO_MANY_REQUESTS');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('FR-1: Your tickets', () => {
  test('an Owner sees every Ticket of the Business with From, never another Business', async () => {
    const w = await world(actors.ownerA);
    w.store.tickets.seed(aTicket({ number: 1001, openedByMemberId: members.memberA.id }));
    w.store.tickets.seed(aTicket({ number: 1002, openedByMemberId: members.ownerA.id }));
    w.store.tickets.seed(
      aTicket({ number: 1003, businessId: BUSINESS_B, openedByMemberId: members.ownerB.id }),
    );
    const res = await w.app.inject({ method: 'GET', url: '/api/support/tickets' });
    expect(res.statusCode).toBe(200);
    const page = listTickets.response.parse(res.json());
    expect(page.showFrom).toBe(true);
    expect(page.items.map((i) => i.number).sort()).toEqual([1001, 1002]);
    expect(page.items.find((i) => i.number === 1001)?.openedBy.name).toBe('Jo Kim');
    expect(page.counts).toEqual({ open: 2, closed: 0 });
  });

  test('a Member sees only their own Tickets and no From column', async () => {
    const w = await world(actors.memberA);
    w.store.tickets.seed(aTicket({ number: 1001, openedByMemberId: members.memberA.id }));
    w.store.tickets.seed(aTicket({ number: 1002, openedByMemberId: members.ownerA.id }));
    const page = listTickets.response.parse(
      (await w.app.inject({ method: 'GET', url: '/api/support/tickets?status=all' })).json(),
    );
    expect(page.showFrom).toBe(false);
    expect(page.items.map((i) => i.number)).toEqual([1001]);
  });

  test('rows carry the last reply preview signed by Support and the linked run', async () => {
    const w = await world(actors.memberA);
    await stored(w, (t, ctx) => [
      staffReply(t, { staffId: members.staff1.id, text: 'x'.repeat(200) }, ctx),
    ]);
    const page = listTickets.response.parse(
      (await w.app.inject({ method: 'GET', url: '/api/support/tickets' })).json(),
    );
    expect(page.items[0]?.preview).toEqual({
      author: 'support',
      authorName: 'Llyner Leads Support',
      text: 'x'.repeat(80),
    });
    expect(page.items[0]?.run).toEqual({ id: RUN_ID, planName: 'Bakeries near Austin' });
  });

  test('GET works read-only while Acting as and shows the Owner view', async () => {
    const w = await world(actors.staffActingAsA);
    w.store.tickets.seed(aTicket({ number: 1001, openedByMemberId: members.memberA.id }));
    const list = await w.app.inject({ method: 'GET', url: '/api/support/tickets' });
    expect(list.statusCode).toBe(200);
    expect(listTickets.response.parse(list.json()).items).toHaveLength(1);
    const detail = ticketDetail.parse(
      (await w.app.inject({ method: 'GET', url: '/api/support/tickets/1001' })).json(),
    );
    expect(detail).toMatchObject({ readOnly: true, canReply: false, canClose: false });
  });
});

describe('FR-4: ticket thread', () => {
  test('404 TICKET_NOT_FOUND for another Business, for another Member (non-Owner) and for unknown numbers', async () => {
    const w = await world(actors.memberA);
    w.store.tickets.seed(
      aTicket({ number: 1001, businessId: BUSINESS_B, openedByMemberId: members.ownerB.id }),
    );
    w.store.tickets.seed(aTicket({ number: 1002, openedByMemberId: members.ownerA.id }));
    for (const n of [1001, 1002, 4242]) {
      const res = await w.app.inject({ method: 'GET', url: `/api/support/tickets/${String(n)}` });
      expect(res.statusCode).toBe(404);
      expect(code(res)).toBe('TICKET_NOT_FOUND');
    }
    for (const n of [1001, 1002]) {
      expect(
        (
          await w.app.inject({
            method: 'POST',
            url: `/api/support/tickets/${String(n)}/replies`,
            payload: { message: 'hi' },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await w.app.inject({
            method: 'POST',
            url: `/api/support/tickets/${String(n)}/close`,
            payload: {},
          })
        ).statusCode,
      ).toBe(404);
    }
  });

  test('the Owner can read another Member Ticket', async () => {
    const w = await world(actors.ownerA);
    w.store.tickets.seed(aTicket({ number: 1001, openedByMemberId: members.memberA.id }));
    expect(
      (await w.app.inject({ method: 'GET', url: '/api/support/tickets/1001' })).statusCode,
    ).toBe(200);
  });

  test('no customer response contains an Internal note, a Staff name or an assignment event', async () => {
    const w = await world(actors.memberA);
    const t = await stored(w, (ticket, ctx) => {
      const taken = take(ticket, { staffId: members.staff1.id }, ctx);
      const noted = addNote(taken.ticket, { staffId: members.staff1.id, text: SECRET }, ctx);
      const assigned = assign(
        noted.ticket,
        { staffId: members.staff1.id, assigneeId: members.staff2.id },
        ctx,
      );
      const replied = staffReply(
        assigned.ticket,
        { staffId: members.staff2.id, text: 'We are looking into it.' },
        ctx,
      );
      return [taken, noted, assigned, replied];
    });
    const responses = [
      await w.app.inject({ method: 'GET', url: `/api/support/tickets/${String(t.number)}` }),
      await w.app.inject({ method: 'GET', url: '/api/support/tickets?status=all' }),
      await w.app.inject({
        method: 'POST',
        url: `/api/support/tickets/${String(t.number)}/replies`,
        payload: { message: 'Thanks' },
      }),
      await w.app.inject({
        method: 'POST',
        url: `/api/support/tickets/${String(t.number)}/close`,
        payload: {},
      }),
    ];
    for (const res of responses) {
      expect(res.statusCode).toBeLessThan(300);
      expect(res.body).not.toContain('INTERNAL-ONLY');
      expect(res.body).not.toContain('Sam Staff');
      expect(res.body).not.toContain('Lee Staff');
      expect(res.body).not.toContain('assigned');
      expect(res.body).not.toContain('internal_note');
    }
    const detail = ticketDetail.parse(responses[0]?.json());
    expect(detail.messages.map((m) => m.kind)).toEqual([
      'customer_reply',
      'status_event',
      'staff_reply',
    ]);
    expect(detail.messages[2]?.author).toEqual({ kind: 'support', name: 'Llyner Leads Support' });
    expect(detail.messages[1]).toMatchObject({ status: 'in_progress', body: null, author: null });
    for (const m of detail.messages) expect(() => customerMessage.parse(m)).not.toThrow();
  });
});

describe('FR-4: reply', () => {
  test('a reply on a waiting_on_customer Ticket returns it to in_progress and publishes CustomerReplied', async () => {
    const w = await world(actors.memberA);
    w.store.tickets.seed(
      ticketIn('waiting_on_customer', { number: 1001, openedByMemberId: members.memberA.id }),
    );
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/support/tickets/1001/replies',
      payload: { message: '  Use Sweet Supply Co.  ' },
    });
    expect(res.statusCode).toBe(201);
    const detail = replyToTicket.response.parse(res.json());
    expect(detail.status).toBe('in_progress');
    expect(detail.messages.filter((m) => m.kind === 'customer_reply').at(-1)?.body).toBe(
      'Use Sweet Supply Co.',
    );
    expect(w.store.published.map((e) => e.type)).toEqual(['CustomerReplied']);
    expect(names(w).sort()).toEqual(['ticket_replied', 'ticket_status_changed']);
    const byName = (name: string) => w.analytics.events.find((e) => e.name === name);
    expect(byName('ticket_replied')?.properties).toEqual({
      ticket_number: 1001,
      by: 'customer',
      minutes_since_last: expect.any(Number) as number,
      is_first_staff_reply: false,
    });
    expect(byName('ticket_status_changed')?.properties).toEqual({
      ticket_number: 1001,
      from: 'waiting_on_customer',
      to: 'in_progress',
      by: 'customer',
    });
  });

  test('a reply on a Ticket closed 10 days ago reopens it and keeps the assignee', async () => {
    const w = await world(actors.memberA);
    w.store.tickets.seed(ticketIn('closed', { number: 1001, closedDaysAgo: 10 }));
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/support/tickets/1001/replies',
      payload: { message: 'Still broken' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ status: string; reopenUntil: unknown }>()).toMatchObject({
      status: 'open',
      reopenUntil: null,
    });
    expect((await w.store.read.findByNumber(1001))?.assigneeId).toBe(members.staff1.id);
    const reopened = w.analytics.events.find((e) => e.name === 'ticket_reopened');
    expect(reopened?.properties).toEqual({
      ticket_number: 1001,
      by: 'customer',
      days_since_closed: 10,
    });
  });

  test('409 TICKET_CLOSED_TOO_LONG after 30 days, with closedAt', async () => {
    const w = await world(actors.memberA);
    const t = ticketIn('closed', { number: 1001, closedDaysAgo: 31 });
    w.store.tickets.seed(t);
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/support/tickets/1001/replies',
      payload: { message: 'Hello?' },
    });
    expect(res.statusCode).toBe(409);
    expect(ticketClosedTooLongError.parse(res.json()).error.details.closedAt).toBe(
      t.closedAt?.toISOString(),
    );
    const detail = ticketDetail.parse(
      (await w.app.inject({ method: 'GET', url: '/api/support/tickets/1001' })).json(),
    );
    expect(detail).toMatchObject({ canReply: false, canClose: false });
    expect(detail.reopenUntil).toBe(
      new Date((t.closedAt?.getTime() ?? 0) + 30 * DAY).toISOString(),
    );
  });

  test('400 for an empty message', async () => {
    const w = await world(actors.memberA);
    w.store.tickets.seed(aTicket({ number: 1001 }));
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/support/tickets/1001/replies',
      payload: { message: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('403 NOT_WHILE_ACTING_AS', async () => {
    const w = await world(actors.staffActingAsA);
    w.store.tickets.seed(aTicket({ number: 1001 }));
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/support/tickets/1001/replies',
      payload: { message: 'hi' },
    });
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('NOT_WHILE_ACTING_AS');
  });

  test('429 with Retry-After after 30 messages in an hour', async () => {
    const w = await world(actors.memberA);
    const busy = aTicket({ number: 1001 });
    const replies: TicketMessage[] = Array.from({ length: 30 }, (_, i) => ({
      id: `m0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      ticketId: busy.id,
      kind: 'customer_reply',
      authorMemberId: members.memberA.id,
      body: 'again',
      event: null,
      emailed: false,
      createdAt: new Date(NOW.getTime() - (i + 1) * 60_000),
    }));
    w.store.tickets.seed(busy, replies);
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/support/tickets/1001/replies',
      payload: { message: 'one more' },
    });
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('FR-5: close', () => {
  test('closes, publishes nothing and tracks status and closed events', async () => {
    const w = await world(actors.memberA);
    w.store.tickets.seed(aTicket({ number: 1001, createdAt: new Date(NOW.getTime() - 3 * HOUR) }));
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/support/tickets/1001/close',
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(closeTicket.response.parse(res.json())).toMatchObject({
      status: 'closed',
      canReply: true,
      canClose: false,
    });
    expect(w.store.published).toEqual([]);
    expect(w.analytics.events.map((e) => e.name)).toEqual([
      'ticket_status_changed',
      'ticket_closed',
    ]);
    expect(w.analytics.events[1]?.properties).toEqual({
      ticket_number: 1001,
      by: 'customer',
      minutes_open: 180,
      staff_replies: 0,
      customer_replies: 0,
    });
  });

  test('accepts an empty request body', async () => {
    const w = await world(actors.memberA);
    w.store.tickets.seed(aTicket({ number: 1001 }));
    expect(
      (await w.app.inject({ method: 'POST', url: '/api/support/tickets/1001/close' })).statusCode,
    ).toBe(200);
  });

  test('409 ALREADY_CLOSED', async () => {
    const w = await world(actors.memberA);
    w.store.tickets.seed(ticketIn('closed', { number: 1001 }));
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/support/tickets/1001/close',
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe('ALREADY_CLOSED');
  });

  test('403 NOT_WHILE_ACTING_AS', async () => {
    const w = await world(actors.staffActingAsA);
    w.store.tickets.seed(aTicket({ number: 1001 }));
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/support/tickets/1001/close',
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(w.store.published).toEqual([]);
  });
});

describe('FR-2: run picker', () => {
  test('lists the Business runs of the last 90 days', async () => {
    const w = await world(actors.memberA);
    const res = await w.app.inject({ method: 'GET', url: '/api/support/runs' });
    expect(res.statusCode).toBe(200);
    expect(listSupportRuns.response.parse(res.json()).items.map((r) => r.id)).toEqual([RUN_ID]);
  });
});
