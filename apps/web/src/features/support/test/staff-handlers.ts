import { errorResponse } from '@app/contracts/errors';
import { ids, me as meExample } from '@app/contracts/examples';
import { startActingAs } from '@app/contracts/identity';
import {
  addInternalNote,
  assignTicket,
  getStaffTicket,
  getWaitingCount,
  listStaffTickets,
  listSupportStaff,
  setTicketStatus,
  staffReplyToTicket,
  staffTicketDetail,
  staffTicketSummary,
  takeTicket,
  type StaffMessage,
  type StaffTicketDetail,
  type StaffView,
  type StaffMemberRef,
  type Status,
} from '@app/contracts/support';
import { http, HttpResponse } from 'msw';

const uuid = (n: number) => `0193a1b2-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const staffMe: StaffMemberRef = {
  id: ids.member,
  name: 'Dana Staff',
  email: 'dana@llyner.test',
};
export const otherStaff: StaffMemberRef = {
  id: uuid(901),
  name: 'Lee Ortiz',
  email: 'lee@llyner.test',
};

export const staffState: {
  tickets: StaffTicketDetail[];
  /** The next write answers 409 VERSION_CONFLICT with this ticket's current state. */
  conflictOnNext: boolean;
  /** The next reply answers 409 TICKET_CLOSED_TOO_LONG. */
  closedTooLongOnNext: boolean;
  failNextWrite: boolean;
  listQueries: Record<string, string>[];
  writes: { path: string; body: unknown }[];
  actedAs: { businessId: string; ticketNumber?: number | undefined }[];
  countCalls: number;
  pageSize: number;
} = {
  tickets: [],
  conflictOnNext: false,
  closedTooLongOnNext: false,
  failNextWrite: false,
  listQueries: [],
  writes: [],
  actedAs: [],
  countCalls: 0,
  pageSize: 25,
};

const at = (hhmm: string) => `2026-11-21T${hhmm}:00.000Z`;
const author = { id: uuid(801), name: 'Sam Rivera', isStaff: false };
const message = (n: number, m: Partial<StaffMessage>): StaffMessage => ({
  id: uuid(700 + n),
  kind: 'customer_reply',
  body: null,
  author,
  event: null,
  emailed: false,
  createdAt: at('09:52'),
  ...m,
});

export function ticketFixture(
  number: number,
  overrides: Partial<StaffTicketDetail> = {},
): StaffTicketDetail {
  return staffTicketDetail.parse({
    number,
    subject: `Subject ${number}`,
    category: 'account',
    status: 'open',
    source: 'help',
    openedBy: { id: author.id, name: 'Maria Lopez' },
    preview: null,
    run: null,
    lastMessageAt: at('09:52'),
    closedAt: null,
    createdAt: at('09:52'),
    business: { id: uuid(850 + (number % 10)), name: `Business ${number}` },
    assignee: null,
    waitingSince: at('09:52'),
    waitMinutes: 130,
    unreadCustomerReply: false,
    version: 1,
    messages: [
      message(number, { body: `Body of ${number}`, author: { ...author, name: 'Maria Lopez' } }),
    ],
    context: {
      pagePath: '/app/runs/r_2207',
      balanceAtOpen: 214,
      balanceNow: 214,
      openedByRole: 'owner',
      businessOpenTickets: 2,
    },
    firstStaffReplyAt: null,
    businessMinutesToFirstReply: null,
    reopenUntil: null,
    ...overrides,
  });
}

/** The run behind ticket 1042, as the linked run card shows it. */
export const failedRun = {
  id: ids.run,
  planId: ids.plan,
  planName: 'Bakeries & cafés · 5 mi',
  startedAt: at('09:40'),
  status: 'failed' as const,
  stoppedStep: { number: 3, name: 'Website reader' },
  creditsCharged: 0,
  attempt: 1,
  lastError: 'provider 503',
};

export function resetStaffState() {
  staffState.tickets = [
    ticketFixture(1043, { subject: "Can't add my assistant as a Member", waitMinutes: 130 }),
    ticketFixture(1042, {
      subject: 'Run stopped at Website reader',
      category: 'run',
      status: 'in_progress',
      assignee: staffMe,
      waitMinutes: 52,
      unreadCustomerReply: true,
      run: failedRun,
      version: 3,
      context: {
        pagePath: '/app/runs/r_2207',
        balanceAtOpen: 220,
        balanceNow: 214,
        openedByRole: 'owner',
        businessOpenTickets: 2,
      },
      businessMinutesToFirstReply: 50,
      messages: [
        message(1, { body: "Run stopped at step 03 and says it didn't finish. Was I charged?" }),
        message(2, {
          kind: 'event',
          author: { id: staffMe.id, name: staffMe.name, isStaff: true },
          event: { type: 'taken' },
          createdAt: at('10:31'),
        }),
        message(3, {
          kind: 'internal_note',
          body: 'Firecrawl returned 503s from 09:58 to 10:20.',
          author: { id: staffMe.id, name: staffMe.name, isStaff: true },
          createdAt: at('10:38'),
        }),
        message(4, {
          kind: 'staff_reply',
          body: 'Thanks Sam. You paid 0 cr.',
          author: { id: staffMe.id, name: staffMe.name, isStaff: true },
          emailed: true,
          createdAt: at('10:42'),
        }),
      ],
    }),
    ticketFixture(1044, {
      subject: 'Charged twice for a pack?',
      category: 'billing',
      waitMinutes: 18,
    }),
    ticketFixture(1045, {
      subject: 'Waiting on their answer',
      status: 'waiting_on_customer',
      assignee: otherStaff,
      waitMinutes: null,
      waitingSince: null,
    }),
    ticketFixture(1046, {
      subject: 'Old closed one',
      status: 'closed',
      closedAt: at('08:00'),
      waitMinutes: null,
      waitingSince: null,
    }),
  ];
  staffState.conflictOnNext = false;
  staffState.closedTooLongOnNext = false;
  staffState.failNextWrite = false;
  staffState.listQueries = [];
  staffState.writes = [];
  staffState.actedAs = [];
  staffState.countCalls = 0;
  staffState.pageSize = 25;
}
resetStaffState();

const inView = (t: StaffTicketDetail, view: StaffView): boolean => {
  switch (view) {
    case 'waiting':
      return t.waitMinutes !== null;
    case 'mine':
      return t.assignee?.id === staffMe.id && t.status !== 'closed';
    case 'waiting_on_customer':
      return t.status === 'waiting_on_customer';
    case 'closed':
      return t.status === 'closed';
    case 'all':
      return true;
  }
};

const waiting = () => staffState.tickets.filter((t) => inView(t, 'waiting'));

function listBody(raw: Record<string, string>) {
  const query = listStaffTickets.query.parse(raw);
  const matching = staffState.tickets
    .filter((t) => inView(t, query.view))
    .filter((t) => !query.category || t.category === query.category)
    .filter((t) => {
      if (!query.assignee) return true;
      if (query.assignee === 'nobody') return t.assignee === null;
      return t.assignee?.id === (query.assignee === 'me' ? staffMe.id : query.assignee);
    })
    .sort((a, b) => (b.waitMinutes ?? -1) - (a.waitMinutes ?? -1));
  const start = Number(query.cursor ?? 0);
  const items = matching
    .slice(start, start + staffState.pageSize)
    .map((t) => staffTicketSummary.parse(t));
  const next = start + staffState.pageSize;
  const minutes = waiting().map((t) => t.waitMinutes ?? 0);
  return listStaffTickets.response.parse({
    items,
    counts: {
      waiting: waiting().length,
      mine: staffState.tickets.filter((t) => inView(t, 'mine')).length,
      waitingOnCustomer: staffState.tickets.filter((t) => inView(t, 'waiting_on_customer')).length,
    },
    stats: {
      waiting: waiting().length,
      longestWaitMinutes: minutes.length ? Math.max(...minutes) : null,
      firstReplyMedianBusinessMinutes30d: 108,
      closedWithin3DaysPct30d: 92,
    },
    nextCursor: next < matching.length ? String(next) : null,
  });
}

const notFound = () =>
  HttpResponse.json(
    errorResponse.parse({ error: { code: 'TICKET_NOT_FOUND', message: 'No ticket' } }),
    { status: 404 },
  );

function find(params: Record<string, string | readonly string[] | undefined>) {
  return staffState.tickets.find((t) => t.number === Number(params.number));
}

function save(t: StaffTicketDetail, patch: Partial<StaffTicketDetail>): StaffTicketDetail {
  const next = staffTicketDetail.parse({ ...t, ...patch, version: t.version + 1 });
  staffState.tickets = staffState.tickets.map((x) => (x.number === t.number ? next : x));
  return next;
}

const staffAuthor = { id: staffMe.id, name: staffMe.name, isStaff: true };
let counter = 0;
const nextId = () => uuid(5000 + counter++);

function withEvent(
  t: StaffTicketDetail,
  event: NonNullable<StaffMessage['event']>,
): StaffMessage[] {
  return [
    ...t.messages,
    {
      id: nextId(),
      kind: 'event',
      body: null,
      author: staffAuthor,
      event,
      emailed: false,
      createdAt: at('11:00'),
    },
  ];
}

/** Runs a write: records it, then answers with a conflict or failure when the test asked for one. */
async function write(
  request: Request,
  params: Record<string, string | readonly string[] | undefined>,
  path: string,
  apply: (t: StaffTicketDetail, body: never) => Response | StaffTicketDetail,
  parseBody: (raw: unknown) => unknown,
  status = 200,
) {
  const t = find(params);
  if (!t) return notFound();
  const body = parseBody(await request.json());
  staffState.writes.push({ path, body });
  if (staffState.failNextWrite) {
    staffState.failNextWrite = false;
    return HttpResponse.json(
      errorResponse.parse({ error: { code: 'INTERNAL_ERROR', message: 'Boom' } }),
      { status: 500 },
    );
  }
  if (staffState.conflictOnNext) {
    staffState.conflictOnNext = false;
    const latest = save(t, {
      status: 'in_progress',
      assignee: otherStaff,
      waitMinutes: null,
    });
    return HttpResponse.json(
      errorResponse.parse({
        error: { code: 'VERSION_CONFLICT', message: 'Changed', details: { ticket: latest } },
      }),
      { status: 409 },
    );
  }
  const result = apply(t, body as never);
  if (result instanceof Response) return result;
  return HttpResponse.json(staffTicketDetail.parse(result), { status });
}

export const staffHandlers = [
  http.get('*/api/auth/me', () =>
    HttpResponse.json({
      ...meExample,
      member: { ...meExample.member, id: staffMe.id, name: staffMe.name, isStaff: true },
    }),
  ),

  http.get('*/api/staff/support/tickets', ({ request }) => {
    const raw = Object.fromEntries(new URL(request.url).searchParams);
    staffState.listQueries.push(raw);
    return HttpResponse.json(listBody(raw));
  }),

  http.get('*/api/staff/support/count', () => {
    staffState.countCalls += 1;
    return HttpResponse.json(getWaitingCount.response.parse({ waiting: waiting().length }));
  }),

  http.get('*/api/staff/support/staff', () =>
    HttpResponse.json(listSupportStaff.response.parse({ items: [staffMe, otherStaff] })),
  ),

  http.get('*/api/staff/support/tickets/:number', ({ params }) => {
    const t = find(params);
    return t ? HttpResponse.json(getStaffTicket.response.parse(t)) : notFound();
  }),

  http.post('*/api/staff/support/tickets/:number/take', ({ request, params }) =>
    write(
      request,
      params,
      'take',
      (t) =>
        save(t, {
          assignee: staffMe,
          status: t.status === 'open' ? 'in_progress' : t.status,
          waitMinutes: null,
          messages: withEvent(t, { type: 'taken' }),
        }),
      (raw) => takeTicket.body.parse(raw),
    ),
  ),

  http.post('*/api/staff/support/tickets/:number/assign', ({ request, params }) =>
    write(
      request,
      params,
      'assign',
      (t, body: { assigneeId: string | null }) => {
        const to = [staffMe, otherStaff].find((s) => s.id === body.assigneeId) ?? null;
        return save(t, {
          assignee: to && { id: to.id, name: to.name },
          waitMinutes: to ? null : 30,
          messages: withEvent(t, { type: 'assigned', to: to && { id: to.id, name: to.name } }),
        });
      },
      (raw) => assignTicket.body.parse(raw),
    ),
  ),

  http.post('*/api/staff/support/tickets/:number/status', ({ request, params }) =>
    write(
      request,
      params,
      'status',
      (t, body: { status: Status }) =>
        save(t, {
          status: body.status,
          closedAt: body.status === 'closed' ? at('11:00') : null,
          messages: withEvent(t, { type: 'status_changed', from: t.status, to: body.status }),
        }),
      (raw) => setTicketStatus.body.parse(raw),
    ),
  ),

  http.post('*/api/staff/support/tickets/:number/replies', ({ request, params }) =>
    write(
      request,
      params,
      'replies',
      (t, body: { message: string; then?: 'wait_on_customer' | 'close' }) => {
        if (staffState.closedTooLongOnNext) {
          staffState.closedTooLongOnNext = false;
          return HttpResponse.json(
            errorResponse.parse({
              error: {
                code: 'TICKET_CLOSED_TOO_LONG',
                message: 'Closed too long',
                details: { closedAt: at('08:00') },
              },
            }),
            { status: 409 },
          );
        }
        const status: Status =
          body.then === 'close'
            ? 'closed'
            : body.then === 'wait_on_customer'
              ? 'waiting_on_customer'
              : 'in_progress';
        return save(t, {
          status,
          assignee: t.assignee ?? { id: staffMe.id, name: staffMe.name },
          waitMinutes: null,
          unreadCustomerReply: false,
          messages: [
            ...t.messages,
            {
              id: nextId(),
              kind: 'staff_reply',
              body: body.message,
              author: staffAuthor,
              event: null,
              emailed: true,
              createdAt: at('11:05'),
            },
          ],
        });
      },
      (raw) => staffReplyToTicket.body.parse(raw),
      201,
    ),
  ),

  http.post('*/api/staff/support/tickets/:number/notes', ({ request, params }) =>
    write(
      request,
      params,
      'notes',
      (t, body: { note: string }) =>
        save(t, {
          messages: [
            ...t.messages,
            {
              id: nextId(),
              kind: 'internal_note',
              body: body.note,
              author: staffAuthor,
              event: null,
              emailed: false,
              createdAt: at('11:10'),
            },
          ],
        }),
      (raw) => addInternalNote.body.parse(raw),
      201,
    ),
  ),

  http.post('*/api/staff/acting-as', async ({ request }) => {
    const body = startActingAs.body.parse(await request.json());
    staffState.actedAs.push(body);
    const target = staffState.tickets.find((t) => t.business.id === body.businessId);
    return HttpResponse.json(
      startActingAs.response.parse({
        ...meExample,
        member: { ...meExample.member, id: staffMe.id, isStaff: true },
        actingAs: { businessId: body.businessId, businessName: target?.business.name ?? 'Unknown' },
      }),
    );
  }),
];
