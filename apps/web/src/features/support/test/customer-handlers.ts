import { errorResponse } from '@app/contracts/errors';
import { ids, me as meExample } from '@app/contracts/examples';
import { me as meShape, type Me } from '@app/contracts/identity';
import { creditWallet } from '@app/contracts/billing';
import {
  OPEN_TICKET_LIMIT,
  SUPPORT_AUTHOR_NAME,
  closeTicket,
  createTicket,
  createTicketBody,
  getTicket,
  listSupportRuns,
  listTickets,
  replyBody,
  replyToTicket,
  ticketDetail,
  ticketSummary,
  type CustomerMessage,
  type RunRef,
  type TicketDetail,
  type TicketSummary,
} from '@app/contracts/support';
import { http, HttpResponse } from 'msw';

const uuid = (n: number) => `0193a1b2-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const runIds = { failed: uuid(2207), done: uuid(2208) };

export interface Recorded {
  method: string;
  path: string;
  body: unknown;
}

export const customerState: {
  tickets: TicketDetail[];
  runs: RunRef[];
  /** The Owner's view lists every Member's tickets with a From column. */
  showFrom: boolean;
  /** Staff Acting as: every write answers 403 and tickets come back `readOnly`. */
  actingAs: boolean;
  pageSize: number;
  requests: Recorded[];
  nextNumber: number;
} = {
  tickets: [],
  runs: [],
  showFrom: false,
  actingAs: false,
  pageSize: 25,
  requests: [],
  nextNumber: 1043,
};

const member = { id: ids.member, name: 'Sam Rivera' };

export function makeRun(patch: Partial<RunRef> = {}): RunRef {
  return {
    id: runIds.failed,
    planId: ids.plan,
    planName: 'Bakeries & cafés',
    startedAt: '2026-11-21T09:41:00.000Z',
    status: 'failed',
    stoppedStep: { number: 3, name: 'Website reader' },
    creditsCharged: 0,
    ...patch,
  };
}

export function makeMessage(patch: Partial<CustomerMessage> = {}): CustomerMessage {
  return {
    id: uuid(Math.floor(Math.random() * 1e9)),
    kind: 'customer_reply',
    body: 'Hello',
    author: { kind: 'member', ...member },
    status: null,
    createdAt: '2026-11-21T09:52:00.000Z',
    ...patch,
  };
}

export function makeTicket(patch: Partial<TicketDetail> = {}): TicketDetail {
  return ticketDetail.parse({
    number: 1042,
    subject: 'Run stopped at Website reader',
    category: 'run',
    status: 'in_progress',
    source: 'run',
    openedBy: member,
    preview: null,
    run: makeRun(),
    lastMessageAt: '2026-11-21T10:42:00.000Z',
    closedAt: null,
    createdAt: '2026-11-21T09:52:00.000Z',
    messages: [
      makeMessage({
        id: uuid(1),
        body: 'My run stopped at step 03 Website reader. 0 leads. Was I charged?',
      }),
      makeMessage({
        id: uuid(2),
        kind: 'status_event',
        body: null,
        author: null,
        status: 'in_progress',
        createdAt: '2026-11-21T10:31:00.000Z',
      }),
      makeMessage({
        id: uuid(3),
        kind: 'staff_reply',
        body: "Thanks Sam.\nA failed run with 0 leads isn't charged, so you paid 0 cr.",
        author: { kind: 'support', name: SUPPORT_AUTHOR_NAME },
        createdAt: '2026-11-21T10:42:00.000Z',
      }),
    ],
    canReply: true,
    canClose: true,
    reopenUntil: null,
    readOnly: false,
    ...patch,
  });
}

/** Three tickets: one we're on, one waiting on the customer, one closed. */
export function seedTickets(): TicketDetail[] {
  return [
    makeTicket(),
    makeTicket({
      number: 1039,
      subject: 'Invoice for my Starter pack',
      category: 'billing',
      status: 'waiting_on_customer',
      source: 'help',
      openedBy: { id: uuid(77), name: 'Jo Kim' },
      run: null,
      lastMessageAt: '2026-11-20T15:00:00.000Z',
      createdAt: '2026-11-20T09:00:00.000Z',
      messages: [
        makeMessage({
          body: 'I need an invoice.',
          author: { kind: 'member', id: uuid(77), name: 'Jo Kim' },
        }),
        makeMessage({
          kind: 'staff_reply',
          body: 'Which company name should go on it?',
          author: { kind: 'support', name: SUPPORT_AUTHOR_NAME },
        }),
      ],
    }),
    makeTicket({
      number: 1031,
      subject: 'Two phone numbers look wrong',
      status: 'closed',
      run: null,
      closedAt: '2026-11-14T12:00:00.000Z',
      lastMessageAt: '2026-11-14T12:00:00.000Z',
      createdAt: '2026-11-13T09:00:00.000Z',
      reopenUntil: '2026-12-14T12:00:00.000Z',
      canClose: false,
      messages: [
        makeMessage({
          body: 'Two phone numbers look wrong.',
          createdAt: '2026-11-13T09:00:00.000Z',
        }),
      ],
    }),
  ];
}

export function resetCustomerState() {
  customerState.tickets = seedTickets();
  customerState.runs = [
    makeRun(),
    makeRun({
      id: runIds.done,
      planName: 'Florists',
      startedAt: '2026-11-18T14:00:00.000Z',
      status: 'completed',
      stoppedStep: null,
      creditsCharged: 137,
    }),
  ];
  customerState.showFrom = false;
  customerState.actingAs = false;
  customerState.pageSize = 25;
  customerState.requests = [];
  customerState.nextNumber = 1043;
}
resetCustomerState();

const fail = (status: number, code: string, extra: object = {}) =>
  HttpResponse.json(errorResponse.parse({ error: { code, message: code, ...extra } }), { status });

const record = (method: string, path: string, body: unknown) =>
  customerState.requests.push({ method, path, body });

const visible = (t: TicketDetail): TicketDetail => ({ ...t, readOnly: customerState.actingAs });

function summarize(t: TicketDetail): TicketSummary {
  const last = [...t.messages].reverse().find((m) => m.kind !== 'status_event');
  return ticketSummary.parse({
    ...t,
    preview: last
      ? {
          author: last.kind === 'staff_reply' ? 'support' : 'customer',
          authorName: last.author?.name ?? SUPPORT_AUTHOR_NAME,
          text: (last.body ?? '').slice(0, 80),
        }
      : null,
    run: t.run ? { id: t.run.id, planName: t.run.planName } : null,
  });
}

const isOpen = (t: TicketDetail) => t.status !== 'closed';
const find = (n: unknown) => customerState.tickets.find((t) => t.number === Number(n));

/** The signed-in Member as `GET /api/auth/me` answers it (honours `customerState.actingAs`). */
export function currentMe(): Me {
  return meShape.parse({
    ...meExample,
    member: { ...meExample.member, name: member.name },
    actingAs: customerState.actingAs
      ? { businessId: ids.business, businessName: meExample.business.name }
      : null,
  });
}

/** Other features own `/auth/me` and `/credits`; tests that need Acting as or a balance add these. */
export const sessionHandlers = [
  http.get('*/api/auth/me', () => HttpResponse.json(currentMe())),
  http.get('*/api/credits', () =>
    HttpResponse.json(
      creditWallet.parse({
        balance: 214,
        reserved: 0,
        available: 214,
        packs: [],
        paymentsAvailable: true,
      }),
    ),
  ),
];

export const handlers = [
  http.get('*/api/support/tickets', ({ request }) => {
    const query = new URL(request.url).searchParams;
    const filter = query.get('status') ?? 'open';
    const open = customerState.tickets
      .filter(isOpen)
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
    const closed = customerState.tickets
      .filter((t) => !isOpen(t))
      .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''));
    const all = filter === 'open' ? open : filter === 'closed' ? closed : [...open, ...closed];
    const start = Number(query.get('cursor') ?? 0);
    const slice = all.slice(start, start + customerState.pageSize);
    const next = start + slice.length;
    return HttpResponse.json(
      listTickets.response.parse({
        items: slice.map(summarize),
        counts: { open: open.length, closed: closed.length },
        showFrom: customerState.showFrom,
        nextCursor: next < all.length ? String(next) : null,
      }),
    );
  }),

  http.post('*/api/support/tickets', async ({ request }) => {
    const raw: unknown = await request.json();
    record('POST', '/support/tickets', raw);
    if (customerState.actingAs) return fail(403, 'NOT_WHILE_ACTING_AS');
    const body = createTicketBody.safeParse(raw);
    if (!body.success) {
      const fields = Object.fromEntries(
        body.error.issues.map((i) => [String(i.path[0]), i.message]),
      );
      return fail(400, 'VALIDATION_ERROR', { fields });
    }
    if (customerState.tickets.filter(isOpen).length >= OPEN_TICKET_LIMIT) {
      return fail(422, 'OPEN_TICKET_LIMIT', { details: { limit: OPEN_TICKET_LIMIT } });
    }
    const run = body.data.runId ? customerState.runs.find((r) => r.id === body.data.runId) : null;
    if (body.data.runId && !run) return fail(404, 'UNKNOWN_RUN');
    const now = '2026-11-21T11:00:00.000Z';
    const ticket = makeTicket({
      number: customerState.nextNumber++,
      subject: body.data.subject,
      category: body.data.category,
      status: 'open',
      source: body.data.source,
      run: run ?? null,
      createdAt: now,
      lastMessageAt: now,
      messages: [makeMessage({ body: body.data.message, createdAt: now })],
    });
    customerState.tickets.push(ticket);
    return HttpResponse.json(createTicket.response.parse(visible(ticket)), { status: 201 });
  }),

  http.get('*/api/support/runs', () =>
    HttpResponse.json(listSupportRuns.response.parse({ items: customerState.runs })),
  ),

  http.get('*/api/support/tickets/:number', ({ params }) => {
    const ticket = find(params.number);
    return ticket
      ? HttpResponse.json(getTicket.response.parse(visible(ticket)))
      : fail(404, 'TICKET_NOT_FOUND');
  }),

  http.post('*/api/support/tickets/:number/replies', async ({ params, request }) => {
    const raw: unknown = await request.json();
    record('POST', `/support/tickets/${String(params.number)}/replies`, raw);
    if (customerState.actingAs) return fail(403, 'NOT_WHILE_ACTING_AS');
    const ticket = find(params.number);
    if (!ticket) return fail(404, 'TICKET_NOT_FOUND');
    const body = replyBody.safeParse(raw);
    if (!body.success) return fail(400, 'VALIDATION_ERROR', { fields: { message: 'Invalid' } });
    if (!ticket.canReply) {
      return fail(409, 'TICKET_CLOSED_TOO_LONG', { details: { closedAt: ticket.closedAt } });
    }
    ticket.messages.push(
      makeMessage({ body: body.data.message, createdAt: '2026-11-21T11:05:00.000Z' }),
    );
    if (ticket.status === 'closed') {
      ticket.status = 'open';
      ticket.closedAt = null;
      ticket.reopenUntil = null;
      ticket.canClose = true;
    }
    return HttpResponse.json(replyToTicket.response.parse(visible(ticket)), { status: 201 });
  }),

  http.post('*/api/support/tickets/:number/close', ({ params }) => {
    record('POST', `/support/tickets/${String(params.number)}/close`, {});
    if (customerState.actingAs) return fail(403, 'NOT_WHILE_ACTING_AS');
    const ticket = find(params.number);
    if (!ticket) return fail(404, 'TICKET_NOT_FOUND');
    if (ticket.status === 'closed') return fail(409, 'ALREADY_CLOSED');
    ticket.status = 'closed';
    ticket.closedAt = '2026-11-21T11:10:00.000Z';
    ticket.reopenUntil = '2026-12-21T11:10:00.000Z';
    ticket.canClose = false;
    ticket.messages.push(
      makeMessage({ kind: 'status_event', body: null, author: null, status: 'closed' }),
    );
    return HttpResponse.json(closeTicket.response.parse(visible(ticket)));
  }),
];
