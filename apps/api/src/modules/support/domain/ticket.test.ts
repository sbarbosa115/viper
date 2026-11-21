import { describe, expect, test } from 'vitest';
import { CodedError, ValidationError } from '../../../shared/domain/errors.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import {
  aTicket,
  FRIDAY,
  members,
  NOW,
  openInput,
  ticketCtx,
  ticketIn,
} from '../test/factories.js';
import { isWaiting } from './rules.js';
import {
  addNote,
  assertVersion,
  assign,
  customerClose,
  customerReply,
  markReadByAssignee,
  normalizePagePath,
  openTicket,
  outboxEvents,
  reopenUntil,
  setStatus,
  staffReply,
  take,
  withNumber,
  type Ticket,
  type TicketChange,
  type TicketContext,
  type TicketStatus,
} from './ticket.js';

const DAY = 24 * 3600_000;
const staff1 = members.staff1.id;
const staff2 = members.staff2.id;
const customer = members.memberA.id;
const ctx = (): TicketContext => ticketCtx(NOW);

const closedDaysAgo = (days: number, overrides: Partial<Ticket> = {}) =>
  ticketIn('closed', { closedDaysAgo: days, ...overrides });

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof CodedError ? e.code : String(e);
  }
}

interface Expected {
  status?: TicketStatus;
  assigneeId?: string | null;
  waitingSince?: 'now' | 'null' | 'kept';
  events?: string[];
  facts?: string[];
  /** Kinds of the appended messages (`event:<type>` for events). */
  messages?: string[];
  changed?: boolean;
  error?: string;
}

type Row = [label: string, before: Ticket, act: (t: Ticket) => TicketChange, expected: Expected];

function check(before: Ticket, act: (t: Ticket) => TicketChange, expected: Expected): void {
  if (expected.error) {
    expect(codeOf(() => act(before))).toBe(expected.error);
    return;
  }
  const change = act(before);
  const after = change.ticket;
  if (expected.status) expect(after.status).toBe(expected.status);
  if (expected.assigneeId !== undefined) expect(after.assigneeId).toBe(expected.assigneeId);
  if (expected.waitingSince === 'now') expect(after.waitingSince).toEqual(NOW);
  if (expected.waitingSince === 'null') expect(after.waitingSince).toBeNull();
  if (expected.waitingSince === 'kept') expect(after.waitingSince).toEqual(before.waitingSince);
  if (expected.events) expect(change.events.map((e) => e.type)).toEqual(expected.events);
  if (expected.facts) expect(change.facts.map((f) => f.type)).toEqual(expected.facts);
  if (expected.messages) {
    expect(change.messages.map((m) => (m.event ? `event:${m.event.type}` : m.kind))).toEqual(
      expected.messages,
    );
  }
  const changed = expected.changed ?? true;
  expect(change.changed).toBe(changed);
  expect(change.expectedVersion).toBe(before.version);
  // The version guards only what another Staff Member could overwrite: status and assignee.
  const bumped = after.status !== before.status || after.assigneeId !== before.assigneeId;
  expect(after.version).toBe(before.version + (bumped ? 1 : 0));
  if (changed) expect(after.updatedAt).toEqual(NOW);
  // Close fields always agree with the status.
  expect(after.closedAt === null).toBe(after.status !== 'closed');
  expect(after.closedBy === null).toBe(after.status !== 'closed');
}

describe('FR-2: open a ticket', () => {
  test('a new Ticket is open, unassigned, waiting since now, with the first message', () => {
    const opened = openTicket(openInput({ subject: '  Run failed  ' }), ctx());
    expect(opened.ticket).toMatchObject({
      status: 'open',
      assigneeId: null,
      version: 0,
      subject: 'Run failed',
      waitingSince: NOW,
      lastMessageAt: NOW,
      lastMessageBy: 'customer',
      createdAt: NOW,
      pagePath: '/app/runs/123',
    });
    expect(opened.messages).toHaveLength(1);
    expect(opened.messages[0]).toMatchObject({ kind: 'customer_reply', authorMemberId: customer });
    expect(opened.events).toEqual([{ type: 'TicketOpened', messageId: opened.messages[0]?.id }]);
    expect(opened.facts).toEqual([{ type: 'opened' }]);
  });

  test.each([
    ['/app/runs/1', '/app/runs/1'],
    ['/settings', null],
    ['https://evil.test/app/', null],
    [`/app/${'x'.repeat(196)}`, null],
    [`/app/${'x'.repeat(195)}`, `/app/${'x'.repeat(195)}`],
    [null, null],
  ])('page path %s is kept as %s', (from, kept) => {
    expect(normalizePagePath(from)).toBe(kept);
  });

  test.each([
    ['subject of 4 characters', { subject: 'abcd' }, 'subject'],
    ['subject of 121 characters', { subject: 'a'.repeat(121) }, 'subject'],
    ['message of 9 characters', { message: '123456789' }, 'message'],
    ['message of spaces', { message: '            ' }, 'message'],
  ])('%s → ValidationError on that field', (_label, overrides, field) => {
    try {
      openTicket(openInput(overrides), ctx());
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect(Object.keys((e as ValidationError).details ?? {})).toEqual([field]);
    }
  });

  test('outbox events carry the Ticket ids and number once it has one', () => {
    const opened = openTicket(openInput(), ctx());
    const ticket = withNumber(opened.ticket, 1042);
    expect(outboxEvents(ticket, opened.events)).toEqual([
      {
        type: 'TicketOpened',
        payload: {
          ticketId: ticket.id,
          ticketNumber: 1042,
          businessId: ticket.businessId,
          openedByMemberId: customer,
          assigneeId: null,
          messageId: opened.messages[0]?.id,
        },
      },
    ]);
  });
});

describe('FR-4: customer reply (status × reopen window)', () => {
  const reply = (t: Ticket) => customerReply(t, { memberId: customer, text: 'Any news?' }, ctx());
  const rows: Row[] = [
    [
      'open, unassigned: stays open, waitingSince kept',
      aTicket(),
      reply,
      {
        status: 'open',
        waitingSince: 'kept',
        events: ['CustomerReplied'],
        messages: ['customer_reply'],
      },
    ],
    [
      'in_progress, read: stays, waiting again since now',
      ticketIn('in_progress'),
      reply,
      {
        status: 'in_progress',
        assigneeId: staff1,
        waitingSince: 'now',
        facts: ['customer_replied'],
      },
    ],
    [
      'waiting_on_customer, assigned → in_progress',
      ticketIn('waiting_on_customer'),
      reply,
      {
        status: 'in_progress',
        waitingSince: 'now',
        messages: ['customer_reply', 'event:status_changed'],
        facts: ['status_changed', 'customer_replied'],
      },
    ],
    [
      'waiting_on_customer, unassigned → open',
      ticketIn('waiting_on_customer', { assigneeId: null }),
      reply,
      { status: 'open', waitingSince: 'now' },
    ],
    [
      'closed 10 days ago → open, assignee kept, reopened',
      closedDaysAgo(10),
      reply,
      {
        status: 'open',
        assigneeId: staff1,
        waitingSince: 'now',
        events: ['CustomerReplied'],
        facts: ['status_changed', 'reopened', 'customer_replied'],
      },
    ],
    ['closed exactly 30 days ago → open', closedDaysAgo(30), reply, { status: 'open' }],
    ['closed 31 days ago → 409', closedDaysAgo(31), reply, { error: 'TICKET_CLOSED_TOO_LONG' }],
  ];
  test.each(rows)('%s', (_label, before, act, expected) => check(before, act, expected));

  test('TICKET_CLOSED_TOO_LONG carries closedAt', () => {
    const t = closedDaysAgo(31);
    try {
      reply(t);
      expect.unreachable();
    } catch (e) {
      expect((e as CodedError).details).toEqual({ closedAt: t.closedAt?.toISOString() });
      expect((e as CodedError).status).toBe(409);
    }
  });

  test('an empty reply is a ValidationError', () => {
    expect(() => customerReply(aTicket(), { memberId: customer, text: '  ' }, ctx())).toThrow(
      ValidationError,
    );
  });

  test('the status event is authored by the customer and follows the reply', () => {
    const change = reply(ticketIn('waiting_on_customer'));
    expect(change.messages.map((m) => m.authorMemberId)).toEqual([customer, customer]);
    expect(change.messages[1]?.event).toEqual({
      type: 'status_changed',
      from: 'waiting_on_customer',
      to: 'in_progress',
    });
  });
});

describe('FR-5: customer closes', () => {
  const close = (t: Ticket) => customerClose(t, { memberId: customer }, ctx());
  const closedByCustomer: Expected = {
    status: 'closed',
    waitingSince: 'null',
    events: [],
    facts: ['status_changed', 'closed'],
    messages: ['event:status_changed'],
  };
  const rows: Row[] = [
    ['open', aTicket(), close, closedByCustomer],
    ['in_progress', ticketIn('in_progress'), close, closedByCustomer],
    ['waiting_on_customer', ticketIn('waiting_on_customer'), close, closedByCustomer],
    ['closed', closedDaysAgo(1), close, { error: 'ALREADY_CLOSED' }],
  ];
  test.each(rows)('%s', (_label, before, act, expected) => check(before, act, expected));

  test('closedBy customer, closedAt now, no outbox event (nobody is emailed)', () => {
    const change = close(aTicket());
    expect(change.ticket).toMatchObject({ closedBy: 'customer', closedAt: NOW, version: 1 });
    expect(change.events).toEqual([]);
    expect(change.messages[0]?.event).toEqual({
      type: 'status_changed',
      from: 'open',
      to: 'closed',
    });
  });
});

describe('FR-9: Staff reply, reply & wait, reply & close', () => {
  const reply = (then?: 'wait_on_customer' | 'close') => (t: Ticket) =>
    staffReply(t, { staffId: staff2, text: 'Looking into it', then }, ctx());
  const rows: Row[] = [
    [
      'open, unassigned → in_progress, assigned to the replier',
      aTicket(),
      reply(),
      {
        status: 'in_progress',
        assigneeId: staff2,
        waitingSince: 'null',
        events: ['StaffReplied'],
        messages: ['staff_reply', 'event:status_changed'],
      },
    ],
    [
      'open, assigned → in_progress, assignee kept',
      aTicket({ assigneeId: staff1 }),
      reply(),
      { status: 'in_progress', assigneeId: staff1 },
    ],
    [
      'in_progress, unassigned → stays unassigned',
      ticketIn('in_progress', { assigneeId: null, waitingSince: NOW }),
      reply(),
      { status: 'in_progress', assigneeId: null, waitingSince: 'null', messages: ['staff_reply'] },
    ],
    [
      'waiting_on_customer → unchanged status',
      ticketIn('waiting_on_customer'),
      reply(),
      { status: 'waiting_on_customer', events: ['StaffReplied'] },
    ],
    [
      'closed 10 days ago → reopened in_progress, assignee kept',
      closedDaysAgo(10),
      reply(),
      {
        status: 'in_progress',
        assigneeId: staff1,
        facts: ['status_changed', 'reopened', 'staff_replied'],
      },
    ],
    [
      'closed 10 days ago, unassigned → in_progress, assigned to the replier',
      closedDaysAgo(10, { assigneeId: null }),
      reply(),
      { status: 'in_progress', assigneeId: staff2 },
    ],
    ['closed 31 days ago → 409', closedDaysAgo(31), reply(), { error: 'TICKET_CLOSED_TOO_LONG' }],
    [
      'reply & wait on open, unassigned → waiting_on_customer, one status event, assigned',
      aTicket(),
      reply('wait_on_customer'),
      {
        status: 'waiting_on_customer',
        assigneeId: staff2,
        events: ['StaffReplied'],
        messages: ['staff_reply', 'event:status_changed'],
      },
    ],
    [
      'reply & wait on in_progress → waiting_on_customer',
      ticketIn('in_progress'),
      reply('wait_on_customer'),
      { status: 'waiting_on_customer', events: ['StaffReplied'] },
    ],
    [
      'reply & close on in_progress → closed, one TicketClosed and no StaffReplied',
      ticketIn('in_progress', { waitingSince: NOW }),
      reply('close'),
      {
        status: 'closed',
        waitingSince: 'null',
        events: ['TicketClosed'],
        facts: ['status_changed', 'closed', 'staff_replied'],
        messages: ['staff_reply', 'event:status_changed'],
      },
    ],
    [
      'reply & close on a closed Ticket within the window → stays closed, closed again now',
      closedDaysAgo(10),
      reply('close'),
      { status: 'closed', events: ['TicketClosed'], messages: ['staff_reply'] },
    ],
    [
      'reply & close after the window → 409',
      closedDaysAgo(31),
      reply('close'),
      { error: 'TICKET_CLOSED_TOO_LONG' },
    ],
  ];
  test.each(rows)('%s', (_label, before, act, expected) => check(before, act, expected));

  test('close with text: TicketClosed carries the reply id and closedBy staff', () => {
    const change = reply('close')(ticketIn('in_progress'));
    const replyMessage = change.messages[0];
    expect(replyMessage?.kind).toBe('staff_reply');
    expect(change.events).toEqual([
      { type: 'TicketClosed', messageId: replyMessage?.id, closedBy: 'staff' },
    ]);
    expect(change.ticket).toMatchObject({ closedBy: 'staff', closedAt: NOW });
  });

  test('the first Staff reply 50 business minutes after opening sets firstStaffReplyAt', () => {
    const t = aTicket({ createdAt: FRIDAY, waitingSince: FRIDAY, lastMessageAt: FRIDAY });
    const at = new Date(FRIDAY.getTime() + 50 * 60_000);
    const first = staffReply(t, { staffId: staff1, text: 'Hi' }, ticketCtx(at));
    expect(first.ticket.firstStaffReplyAt).toEqual(at);
    expect(first.facts.at(-1)).toMatchObject({
      type: 'staff_replied',
      isFirstStaffReply: true,
      businessMinutesToFirstReply: 50,
    });
    const later = new Date(at.getTime() + 60_000);
    const second = staffReply(first.ticket, { staffId: staff1, text: 'Again' }, ticketCtx(later));
    expect(second.ticket.firstStaffReplyAt).toEqual(at);
    expect(second.facts.at(-1)).toMatchObject({
      isFirstStaffReply: false,
      businessMinutesToFirstReply: null,
    });
  });

  test('a Staff reply takes the Ticket out of the Waiting queue when assigned', () => {
    const change = reply()(ticketIn('in_progress', { waitingSince: NOW }));
    expect(isWaiting(change.ticket)).toBe(false);
    expect(change.ticket.lastMessageBy).toBe('staff');
  });
});

describe('FR-10: Internal notes change nothing else', () => {
  const note = (t: Ticket) => addNote(t, { staffId: staff1, text: 'Checked the logs' }, ctx());
  const statuses: [string, Ticket][] = [
    ['open', aTicket()],
    ['in_progress', ticketIn('in_progress', { waitingSince: NOW })],
    ['waiting_on_customer', ticketIn('waiting_on_customer')],
    ['closed long ago', closedDaysAgo(90)],
  ];
  test.each(statuses)('%s: only an internal_note message, no event, no version', (_l, before) => {
    check(before, note, {
      status: before.status,
      waitingSince: 'kept',
      changed: false,
      events: [],
      facts: ['note_added'],
      messages: ['internal_note'],
    });
    expect(note(before).ticket).toEqual(before);
  });
});

describe('FR-8: take and assign', () => {
  const takeBy = (staffId: string) => (t: Ticket) => take(t, { staffId }, ctx());
  const assignTo = (assigneeId: string | null) => (t: Ticket) =>
    assign(t, { staffId: staff1, assigneeId }, ctx());
  const rows: Row[] = [
    [
      'take open, unassigned → in_progress, mine, taken + status events',
      aTicket(),
      takeBy(staff2),
      {
        status: 'in_progress',
        assigneeId: staff2,
        waitingSince: 'kept',
        events: [],
        facts: ['taken', 'status_changed'],
        messages: ['event:taken', 'event:status_changed'],
      },
    ],
    [
      'take waiting_on_customer of someone else → in_progress, mine',
      ticketIn('waiting_on_customer'),
      takeBy(staff2),
      { status: 'in_progress', assigneeId: staff2 },
    ],
    [
      'take in_progress of someone else → in_progress, mine, no status event',
      ticketIn('in_progress'),
      takeBy(staff2),
      { status: 'in_progress', assigneeId: staff2, messages: ['event:taken'] },
    ],
    [
      'take my own in_progress → nothing changes',
      ticketIn('in_progress'),
      takeBy(staff1),
      { changed: false, messages: [] },
    ],
    [
      'take closed → 409 TICKET_CLOSED',
      closedDaysAgo(1),
      takeBy(staff2),
      { error: 'TICKET_CLOSED' },
    ],
    [
      'assign open to staff1 → status unchanged',
      aTicket(),
      assignTo(staff1),
      { status: 'open', assigneeId: staff1, messages: ['event:assigned'], facts: ['assigned'] },
    ],
    [
      'assign in_progress to nobody',
      ticketIn('in_progress'),
      assignTo(null),
      { status: 'in_progress', assigneeId: null },
    ],
    [
      'assign closed to staff2 → stays closed',
      closedDaysAgo(1),
      assignTo(staff2),
      { status: 'closed', assigneeId: staff2 },
    ],
    [
      'assign to the same assignee → nothing changes',
      ticketIn('in_progress'),
      assignTo(staff1),
      { changed: false },
    ],
  ];
  test.each(rows)('%s', (_label, before, act, expected) => check(before, act, expected));

  test('assigning to nobody puts the Ticket back in the Waiting queue', () => {
    const change = assignTo(null)(ticketIn('in_progress'));
    expect(isWaiting(change.ticket)).toBe(true);
    expect(change.messages[0]?.event).toEqual({ type: 'assigned', assigneeId: null });
  });

  test('a stale version is a 409 VERSION_CONFLICT', () => {
    const t = ticketIn('open', { version: 4 });
    expect(codeOf(() => assertVersion(t, 3))).toBe('VERSION_CONFLICT');
    expect(() => assertVersion(t, 4)).not.toThrow();
  });
});

describe('FR-9: status select', () => {
  const to = (status: TicketStatus) => (t: Ticket) =>
    setStatus(t, { staffId: staff1, status }, ctx());
  const rows: Row[] = [
    [
      'open → waiting_on_customer',
      aTicket(),
      to('waiting_on_customer'),
      { status: 'waiting_on_customer', events: [] },
    ],
    [
      'open → in_progress, no assignment',
      aTicket(),
      to('in_progress'),
      { status: 'in_progress', assigneeId: null },
    ],
    [
      'in_progress → closed: Close, TicketClosed by staff',
      ticketIn('in_progress', { waitingSince: NOW }),
      to('closed'),
      {
        status: 'closed',
        waitingSince: 'null',
        events: ['TicketClosed'],
        facts: ['status_changed', 'closed'],
      },
    ],
    [
      'closed 10 days ago → open reopens',
      closedDaysAgo(10),
      to('open'),
      { status: 'open', events: [], facts: ['status_changed', 'reopened'] },
    ],
    [
      'closed 10 days ago → waiting_on_customer reopens',
      closedDaysAgo(10),
      to('waiting_on_customer'),
      { status: 'waiting_on_customer', facts: ['status_changed', 'reopened'] },
    ],
    [
      'closed 31 days ago → in_progress: 409',
      closedDaysAgo(31),
      to('in_progress'),
      { error: 'TICKET_CLOSED_TOO_LONG' },
    ],
    [
      'closed → closed: nothing changes',
      closedDaysAgo(31),
      to('closed'),
      { changed: false, events: [] },
    ],
    ['open → open: nothing changes', aTicket(), to('open'), { changed: false }],
  ];
  test.each(rows)('%s', (_label, before, act, expected) => check(before, act, expected));

  test('Close events and status messages name the Staff Member', () => {
    const change = to('closed')(ticketIn('in_progress'));
    expect(change.events).toEqual([{ type: 'TicketClosed', messageId: null, closedBy: 'staff' }]);
    expect(change.messages[0]).toMatchObject({
      kind: 'event',
      authorMemberId: staff1,
      event: { type: 'status_changed', from: 'in_progress', to: 'closed' },
    });
  });
});

describe('FR-7: the assignee viewing reads customer replies', () => {
  const view = (staffId: string) => (t: Ticket) => markReadByAssignee(t, { staffId }, ctx());
  const unread = ticketIn('in_progress', { waitingSince: NOW });
  const rows: Row[] = [
    [
      'assignee, unread → read',
      unread,
      view(staff1),
      { waitingSince: 'null', facts: ['marked_read'], messages: [] },
    ],
    ['other Staff → nothing', unread, view(staff2), { waitingSince: 'kept', changed: false }],
    [
      'unassigned → nothing (stays waiting)',
      aTicket(),
      view(staff1),
      { waitingSince: 'kept', changed: false },
    ],
    ['assignee, already read → nothing', ticketIn('in_progress'), view(staff1), { changed: false }],
  ];
  test.each(rows)('%s', (_label, before, act, expected) => check(before, act, expected));

  test('the assignee viewing takes the Ticket out of the Waiting queue', () => {
    expect(isWaiting(unread)).toBe(true);
    expect(isWaiting(view(staff1)(unread).ticket)).toBe(false);
  });

  test('the assignee viewing keeps the version, so another Staff status change still applies', () => {
    const viewed = view(staff1)(unread);
    expect(viewed.changed).toBe(true);
    expect(viewed.ticket.version).toBe(unread.version);
    expect(() => assertVersion(viewed.ticket, unread.version)).not.toThrow();
    const status = setStatus(
      viewed.ticket,
      { staffId: staff2, status: 'waiting_on_customer' },
      ctx(),
    );
    expect(status.ticket.version).toBe(unread.version + 1);
  });
});

describe('version: only status and assignee changes count', () => {
  test.each([
    [
      'customer reply on in_progress',
      ticketIn('in_progress'),
      (t: Ticket) => customerReply(t, { memberId: customer, text: 'Hi' }, ctx()),
      0,
    ],
    [
      'customer reply on waiting_on_customer (status moves)',
      ticketIn('waiting_on_customer'),
      (t: Ticket) => customerReply(t, { memberId: customer, text: 'Hi' }, ctx()),
      1,
    ],
    [
      'Staff reply on assigned in_progress',
      ticketIn('in_progress', { waitingSince: NOW }),
      (t: Ticket) => staffReply(t, { staffId: staff1, text: 'Hi' }, ctx()),
      0,
    ],
    [
      'Staff reply on open (status and assignee move)',
      aTicket(),
      (t: Ticket) => staffReply(t, { staffId: staff1, text: 'Hi' }, ctx()),
      1,
    ],
    ['note', aTicket(), (t: Ticket) => addNote(t, { staffId: staff1, text: 'n' }, ctx()), 0],
    ['take', aTicket(), (t: Ticket) => take(t, { staffId: staff1 }, ctx()), 1],
    [
      'assign',
      aTicket(),
      (t: Ticket) => assign(t, { staffId: staff1, assigneeId: staff2 }, ctx()),
      1,
    ],
  ])('%s → +%d', (_label, before, act, plus) => {
    expect(act(before).ticket.version).toBe(before.version + plus);
  });
});

describe('reopen window', () => {
  test('reopenUntil is closedAt + 30 days for closed Tickets only', () => {
    const t = closedDaysAgo(1);
    expect(reopenUntil(t)).toEqual(new Date((t.closedAt?.getTime() ?? 0) + 30 * DAY));
    expect(reopenUntil(aTicket())).toBeNull();
  });

  test('message ids follow the order they were made', () => {
    const ids = new SequentialIdGenerator();
    const change = customerReply(
      ticketIn('waiting_on_customer'),
      { memberId: customer, text: 'Here it is' },
      { now: NOW, ids },
    );
    const [first, second] = change.messages;
    expect((first?.id ?? '') < (second?.id ?? '')).toBe(true);
  });
});

describe('FR-11: CustomerReplied carries the status right after the reply', () => {
  test.each([
    ['waiting_on_customer, assigned', ticketIn('waiting_on_customer'), 'in_progress'],
    ['closed 10 days ago', closedDaysAgo(10), 'open'],
    ['in_progress', ticketIn('in_progress'), 'in_progress'],
  ])('%s → %s', (_label, before, status) => {
    const change = customerReply(before, { memberId: customer, text: 'Hi' }, ctx());
    const [event] = outboxEvents(change.ticket, change.events);
    expect(event).toEqual({
      type: 'CustomerReplied',
      payload: {
        ticketId: before.id,
        ticketNumber: before.number,
        businessId: before.businessId,
        openedByMemberId: before.openedByMemberId,
        assigneeId: before.assigneeId,
        messageId: change.messages[0]?.id,
        status,
      },
    });
  });
});
