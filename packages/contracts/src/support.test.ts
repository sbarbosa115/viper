import { describe, expect, test } from 'vitest';
import type { Contract } from './common.js';
import { errorCode } from './errors.js';
import { startActingAs } from './identity.js';
import {
  FIRST_TICKET_NUMBER,
  MESSAGE_MAX,
  OPEN_TICKET_LIMIT,
  REOPEN_DAYS,
  categoryLabels,
  createTicket,
  createTicketBody,
  customerMessage,
  noteBody,
  openTicketLimitError,
  replyBody,
  staffMessage,
  staffStatusLabel,
  staffTicketDetail,
  statusLabels,
  supportContracts,
  supportTestContracts,
  ticketClosedTooLongError,
  ticketDetail,
  ticketParams,
  versionConflictError,
  listStaffTickets,
  listTickets,
  type CustomerMessage,
  type RunRef,
  type StaffMessage,
  type StaffTicketDetail,
  type TicketDetail,
} from './support.js';

const at = '2026-11-21T10:00:00.000Z';
const uid = (n: number) => `0193a1b2-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const sam = { id: uid(1), name: 'Sam Rivera' };

const run: RunRef = {
  id: uid(10),
  planId: uid(11),
  planName: 'Bakeries near Austin',
  startedAt: at,
  status: 'failed',
  stoppedStep: { number: 3, name: 'Website reader' },
  creditsCharged: 0,
};

const customerReply: CustomerMessage = {
  id: uid(20),
  kind: 'customer_reply',
  body: 'My run stopped at Website reader.',
  author: { kind: 'member', ...sam },
  status: null,
  createdAt: at,
};

const detail: TicketDetail = {
  number: 1001,
  subject: 'Run stopped at Website reader',
  category: 'run',
  status: 'in_progress',
  source: 'run',
  openedBy: sam,
  preview: { author: 'support', authorName: 'Llyner Leads Support', text: 'Looking into it' },
  run,
  lastMessageAt: at,
  closedAt: null,
  createdAt: at,
  messages: [
    customerReply,
    {
      id: uid(21),
      kind: 'status_event',
      body: null,
      author: null,
      status: 'in_progress',
      createdAt: at,
    },
    {
      id: uid(22),
      kind: 'staff_reply',
      body: 'Looking into it',
      author: { kind: 'support', name: 'Llyner Leads Support' },
      status: null,
      createdAt: at,
    },
  ],
  canReply: true,
  canClose: true,
  reopenUntil: null,
  readOnly: false,
};

const note: StaffMessage = {
  id: uid(30),
  kind: 'internal_note',
  body: 'Provider timeout on step 3.',
  author: { id: uid(2), name: 'Alex Staff', isStaff: true },
  event: null,
  emailed: false,
  createdAt: at,
};

const { canReply: _r, canClose: _c, readOnly: _ro, ...summary } = detail;

const staffDetail: StaffTicketDetail = {
  ...summary,
  business: { id: uid(3), name: 'Sweet Supply Co' },
  assignee: { id: uid(2), name: 'Alex Staff' },
  waitingSince: null,
  waitMinutes: null,
  unreadCustomerReply: false,
  version: 4,
  messages: [
    note,
    {
      id: uid(31),
      kind: 'event',
      body: null,
      author: { id: uid(2), name: 'Alex Staff', isStaff: true },
      event: { type: 'status_changed', from: 'open', to: 'in_progress' },
      emailed: false,
      createdAt: at,
    },
    {
      id: uid(32),
      kind: 'event',
      body: null,
      author: { id: uid(2), name: 'Alex Staff', isStaff: true },
      event: { type: 'assigned', to: null },
      emailed: false,
      createdAt: at,
    },
  ],
  run: { ...run, attempt: 2, lastError: 'Timed out' },
  context: {
    pagePath: '/app/runs/x',
    balanceAtOpen: 863,
    balanceNow: 863,
    openedByRole: 'owner',
    businessOpenTickets: 2,
  },
  firstStaffReplyAt: at,
  businessMinutesToFirstReply: 50,
  reopenUntil: null,
};

describe('support contracts: conventions', () => {
  test('every endpoint of section 7 has a contract', () => {
    const all: Record<string, Contract> = { ...supportContracts, ...supportTestContracts };
    const endpoints = Object.values(all).map((c) => `${c.method} ${c.path}`);
    expect(endpoints.sort()).toEqual(
      [
        'GET /api/support/tickets',
        'POST /api/support/tickets',
        'GET /api/support/tickets/:number',
        'POST /api/support/tickets/:number/replies',
        'POST /api/support/tickets/:number/close',
        'GET /api/support/runs',
        'GET /api/staff/support/tickets',
        'GET /api/staff/support/count',
        'GET /api/staff/support/staff',
        'GET /api/staff/support/tickets/:number',
        'POST /api/staff/support/tickets/:number/take',
        'POST /api/staff/support/tickets/:number/assign',
        'POST /api/staff/support/tickets/:number/status',
        'POST /api/staff/support/tickets/:number/replies',
        'POST /api/staff/support/tickets/:number/notes',
        'POST /api/test/support/close-ago',
        'POST /api/test/support/fill-open',
      ].sort(),
    );
  });

  test('customer endpoints use session auth, Staff endpoints staff auth', () => {
    for (const c of Object.values(supportContracts)) {
      expect(c.auth).toBe(c.path.startsWith('/api/staff/') ? 'staff' : 'session');
    }
  });

  test('every support error code is a declared ErrorCode', () => {
    for (const code of [
      'OPEN_TICKET_LIMIT',
      'UNKNOWN_RUN',
      'NOT_WHILE_ACTING_AS',
      'TICKET_NOT_FOUND',
      'TICKET_CLOSED_TOO_LONG',
      'ALREADY_CLOSED',
      'TICKET_CLOSED',
      'VERSION_CONFLICT',
      'UNKNOWN_STAFF',
    ]) {
      expect(errorCode.options).toContain(code);
    }
    expect(createTicket.errors).toEqual(
      expect.arrayContaining([
        { status: 403, code: 'NOT_WHILE_ACTING_AS' },
        { status: 404, code: 'UNKNOWN_RUN' },
        { status: 422, code: 'OPEN_TICKET_LIMIT' },
        { status: 429, code: 'TOO_MANY_REQUESTS' },
        { status: 400, code: 'VALIDATION_ERROR' },
      ]),
    );
  });

  test('limits and labels', () => {
    expect([FIRST_TICKET_NUMBER, OPEN_TICKET_LIMIT, REOPEN_DAYS, MESSAGE_MAX]).toEqual([
      1001, 5, 30, 10_000,
    ]);
    expect(categoryLabels.run).toBe('Research run / leads');
    expect(statusLabels.waiting_on_customer).toBe('Waiting on you');
    expect(staffStatusLabel('in_progress')).toBe('IN PROGRESS');
  });

  test('ticket numbers in paths are integers from 1001', () => {
    expect(ticketParams.parse({ number: '1042' })).toEqual({ number: 1042 });
    expect(ticketParams.safeParse({ number: '1000' }).success).toBe(false);
    expect(ticketParams.safeParse({ number: 'abc' }).success).toBe(false);
  });
});

describe('FR-2: open a ticket', () => {
  const body = { category: 'run', subject: 'Run stopped', message: 'It stopped at step 3.' };

  test('a valid body defaults source to help and trims', () => {
    expect(createTicketBody.parse({ ...body, subject: '  Run stopped  ' })).toEqual({
      ...body,
      source: 'help',
    });
  });

  test('subject 5..120 and message 10..10,000, after trimming', () => {
    expect(createTicketBody.safeParse({ ...body, subject: 'abcd' }).success).toBe(false);
    expect(createTicketBody.safeParse({ ...body, subject: 'x'.repeat(121) }).success).toBe(false);
    expect(createTicketBody.safeParse({ ...body, message: '123456789' }).success).toBe(false);
    expect(createTicketBody.safeParse({ ...body, message: `  ${'x'.repeat(9)}  ` }).success).toBe(
      false,
    );
    expect(createTicketBody.safeParse({ ...body, message: 'x'.repeat(10_001) }).success).toBe(
      false,
    );
  });

  test('category, source, runId and pagePath are checked', () => {
    expect(createTicketBody.safeParse({ ...body, category: 'sales' }).success).toBe(false);
    expect(createTicketBody.safeParse({ ...body, source: 'email' }).success).toBe(false);
    expect(createTicketBody.safeParse({ ...body, runId: 'nope' }).success).toBe(false);
    expect(createTicketBody.safeParse({ ...body, pagePath: 'x'.repeat(201) }).success).toBe(false);
    expect(
      createTicketBody.safeParse({ ...body, runId: uid(10), source: 'run', pagePath: '/app/x' })
        .success,
    ).toBe(true);
  });

  test('422 OPEN_TICKET_LIMIT carries the limit', () => {
    expect(
      openTicketLimitError.safeParse({
        error: { code: 'OPEN_TICKET_LIMIT', message: 'm', details: { limit: 5 } },
      }).success,
    ).toBe(true);
  });
});

describe('FR-4: customer thread', () => {
  test('a Ticket detail parses', () => {
    expect(ticketDetail.parse(detail)).toEqual(detail);
  });

  test('replies are 1..10,000 characters after trimming', () => {
    expect(replyBody.safeParse({ message: '   ' }).success).toBe(false);
    expect(replyBody.parse({ message: ' ok \n' })).toEqual({ message: 'ok' });
    expect(replyBody.safeParse({ message: 'x'.repeat(10_001) }).success).toBe(false);
  });

  test('409 TICKET_CLOSED_TOO_LONG carries closedAt', () => {
    expect(
      ticketClosedTooLongError.safeParse({
        error: { code: 'TICKET_CLOSED_TOO_LONG', message: 'm', details: { closedAt: at } },
      }).success,
    ).toBe(true);
  });

  test('list query defaults to open', () => {
    expect(listTickets.query.parse({})).toEqual({ status: 'open', limit: 25 });
  });
});

describe('FR-10: customer shapes cannot carry Internal notes', () => {
  test('a message of kind internal_note does not parse as a CustomerMessage', () => {
    expect(customerMessage.safeParse({ ...customerReply, kind: 'internal_note' }).success).toBe(
      false,
    );
    expect(customerMessage.safeParse({ ...customerReply, kind: 'event' }).success).toBe(false);
  });

  test('a Staff message (event, emailed, isStaff) does not parse as a CustomerMessage', () => {
    expect(customerMessage.safeParse(note).success).toBe(false);
    expect(customerMessage.safeParse({ ...customerReply, emailed: false }).success).toBe(false);
  });

  test('a Ticket detail with an Internal note among its messages is rejected', () => {
    const leaked = {
      ...detail,
      messages: [...detail.messages, { ...customerReply, kind: 'internal_note' }],
    };
    expect(ticketDetail.safeParse(leaked).success).toBe(false);
  });

  test('a support author is always "Llyner Leads Support", never a Staff name', () => {
    expect(
      customerMessage.safeParse({
        ...customerReply,
        kind: 'staff_reply',
        author: { kind: 'support', name: 'Alex Staff' },
      }).success,
    ).toBe(false);
    expect(
      customerMessage.safeParse({
        ...customerReply,
        author: { kind: 'support', name: 'Llyner Leads Support', id: uid(2) },
      }).success,
    ).toBe(false);
  });
});

describe('FR-6 to FR-10: Staff shapes', () => {
  test('a Staff Ticket detail parses with notes and events', () => {
    expect(staffTicketDetail.parse(staffDetail)).toEqual(staffDetail);
  });

  test('event types are checked', () => {
    expect(
      staffMessage.safeParse({ ...note, kind: 'event', event: { type: 'deleted' } }).success,
    ).toBe(false);
  });

  test('staff list query defaults to the Waiting view and accepts me, nobody or an id', () => {
    expect(listStaffTickets.query.parse({})).toEqual({ view: 'waiting', limit: 25 });
    expect(listStaffTickets.query.parse({ assignee: 'nobody' }).assignee).toBe('nobody');
    expect(listStaffTickets.query.parse({ assignee: uid(2) }).assignee).toBe(uid(2));
    expect(listStaffTickets.query.safeParse({ assignee: 'someone' }).success).toBe(false);
  });

  test('409 VERSION_CONFLICT carries the current Ticket', () => {
    expect(
      versionConflictError.safeParse({
        error: { code: 'VERSION_CONFLICT', message: 'm', details: { ticket: staffDetail } },
      }).success,
    ).toBe(true);
  });

  test('notes are 1..10,000 characters', () => {
    expect(noteBody.safeParse({ note: '' }).success).toBe(false);
    expect(noteBody.safeParse({ note: 'checked logs' }).success).toBe(true);
  });
});

describe('FR-7: Open as this Business', () => {
  test('acting-as accepts an optional ticketNumber ≥ 1001', () => {
    expect(startActingAs.body.safeParse({ businessId: uid(3) }).success).toBe(true);
    expect(startActingAs.body.safeParse({ businessId: uid(3), ticketNumber: 1042 }).success).toBe(
      true,
    );
    expect(startActingAs.body.safeParse({ businessId: uid(3), ticketNumber: 1000 }).success).toBe(
      false,
    );
  });
});
