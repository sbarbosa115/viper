import { z } from 'zod';
import { credits, defineContract, email, err, id, isoDateTime, listQuery } from './common.js';

/**
 * support: Tickets between a Business's Members and Staff (prd-support section 7, ADR 0021).
 * Customer endpoints use `session` and the visibility rule (anything not visible is 404, never
 * 403); Staff endpoints use `staff` and ignore Acting as. Customer shapes are strict and have no
 * Internal note kind, so a Staff-only message can't be serialized to a customer.
 */

// Limits (prd-support section 6) ---------------------------------------------------------------------

/** The first Ticket number (AUTO_INCREMENT start). Shown as `#1001`. */
export const FIRST_TICKET_NUMBER = 1001;
export const SUBJECT_MIN = 5;
export const SUBJECT_MAX = 120;
/** The first message of a new Ticket. */
export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 10_000;
/** Replies and Internal notes (`Text`). */
export const TEXT_MIN = 1;
export const TEXT_MAX = 10_000;
export const PAGE_PATH_MAX = 200;
/** A list row's preview: the last reply's first 80 characters. */
export const PREVIEW_MAX = 80;
/** Tickets not closed per Business (422 OPEN_TICKET_LIMIT). */
export const OPEN_TICKET_LIMIT = 5;
/** A closed Ticket reopens on a reply until this many days after `closedAt`. */
export const REOPEN_DAYS = 30;
/** New Tickets per Member per hour (429 TOO_MANY_REQUESTS). */
export const TICKETS_PER_HOUR = 10;
/** Customer replies per Member per hour, across Tickets (429 TOO_MANY_REQUESTS). */
export const MESSAGES_PER_HOUR = 30;
/** The run picker lists runs started in the last 90 days… */
export const RUN_PICKER_DAYS = 90;
/** …newest first, at most 50. */
export const RUN_PICKER_LIMIT = 50;
/** Same Member, subject and message within 60 s returns the existing Ticket (200). */
export const DUPLICATE_WINDOW_SECONDS = 60;
/** Lists page by 25. */
export const TICKETS_PAGE_SIZE = 25;
/** How Staff replies are signed to customers, never with the Staff Member's name. */
export const SUPPORT_AUTHOR_NAME = 'Llyner Leads Support';

// Enums --------------------------------------------------------------------------------------------

export const ticketNumber = z.int().min(FIRST_TICKET_NUMBER);
export type TicketNumber = z.infer<typeof ticketNumber>;

export const category = z.enum(['billing', 'run', 'account', 'bug', 'other']);
export type Category = z.infer<typeof category>;

export const categoryLabels: Readonly<Record<Category, string>> = {
  billing: 'Billing and credits',
  run: 'Research run / leads',
  account: 'Account and sign-in',
  bug: 'Bug',
  other: 'Other',
};

export const status = z.enum(['open', 'in_progress', 'waiting_on_customer', 'closed']);
export type Status = z.infer<typeof status>;

/** Customer labels. Staff see the raw name in upper case (`staffStatusLabel`). */
export const statusLabels: Readonly<Record<Status, string>> = {
  open: 'Open',
  in_progress: "We're on it",
  waiting_on_customer: 'Waiting on you',
  closed: 'Closed',
};

/** `in_progress` → `IN PROGRESS`. */
export function staffStatusLabel(s: Status): string {
  return s.replace(/_/g, ' ').toUpperCase();
}

/** Where the Ticket was opened from: Help, a failed run, or a Lead list (FR-3). */
export const source = z.enum(['help', 'run', 'leads']);
export type Source = z.infer<typeof source>;

/** Plain text: trimmed, 1–10,000 characters, line breaks kept. */
export const text = z.string().trim().min(TEXT_MIN).max(TEXT_MAX);

/** `:number` in paths. */
export const ticketParams = z.object({ number: z.coerce.number().pipe(ticketNumber) });
export type TicketParams = z.infer<typeof ticketParams>;

// Shared shapes ------------------------------------------------------------------------------------

const nameRef = z.object({ id, name: z.string() });

/** The run statuses a Ticket can link to (prd-support section 7). */
export const runRefStatus = z.enum(['running', 'retrying', 'completed', 'failed', 'cancelled']);
export type RunRefStatus = z.infer<typeof runRefStatus>;

/** A research run as support shows it (run picker, linked run card). */
export const runRef = z.object({
  id,
  planId: id,
  planName: z.string(),
  startedAt: isoDateTime,
  status: runRefStatus,
  /** The step a failed run stopped at, e.g. `{ number: 3, name: 'Website reader' }`. */
  stoppedStep: z.object({ number: z.int().min(1), name: z.string() }).nullable(),
  creditsCharged: credits.nonnegative(),
});
export type RunRef = z.infer<typeof runRef>;

export const ticketSummary = z.object({
  number: ticketNumber,
  subject: z.string(),
  category,
  status,
  source,
  openedBy: nameRef,
  /** The last reply (not events or notes): its first 80 characters and author. */
  preview: z
    .object({
      author: z.enum(['customer', 'support']),
      /** The Member's name, or "Llyner Leads Support". */
      authorName: z.string(),
      text: z.string().max(PREVIEW_MAX),
    })
    .nullable(),
  run: z.object({ id, planName: z.string() }).nullable(),
  lastMessageAt: isoDateTime,
  closedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type TicketSummary = z.infer<typeof ticketSummary>;

/** Who wrote a message, as the customer sees it: a Member, or "Llyner Leads Support". */
export const customerMessageAuthor = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('member'), id, name: z.string() }),
  z.strictObject({ kind: z.literal('support'), name: z.literal(SUPPORT_AUTHOR_NAME) }),
]);
export type CustomerMessageAuthor = z.infer<typeof customerMessageAuthor>;

/** The kinds a customer may see. Internal notes and take/assign events are never among them. */
export const customerMessageKind = z.enum(['customer_reply', 'staff_reply', 'status_event']);
export type CustomerMessageKind = z.infer<typeof customerMessageKind>;

/** Strict: a Staff message (with `event`, `emailed`, `isStaff`) fails to parse. */
export const customerMessage = z.strictObject({
  id,
  kind: customerMessageKind,
  /** null for status events. */
  body: z.string().nullable(),
  /** null for status events. */
  author: customerMessageAuthor.nullable(),
  /** The new status, for `status_event` only. */
  status: status.nullable(),
  createdAt: isoDateTime,
});
export type CustomerMessage = z.infer<typeof customerMessage>;

export const ticketDetail = ticketSummary.extend({
  run: runRef.nullable(),
  /** Oldest first. */
  messages: z.array(customerMessage),
  /** False after the reopen window or while Acting as. */
  canReply: z.boolean(),
  canClose: z.boolean(),
  /** `closedAt + 30 days` for a closed Ticket; null otherwise. */
  reopenUntil: isoDateTime.nullable(),
  /** Staff Acting as: the page is read-only. */
  readOnly: z.boolean(),
});
export type TicketDetail = z.infer<typeof ticketDetail>;

export const staffMessageKind = z.enum(['customer_reply', 'staff_reply', 'internal_note', 'event']);
export type StaffMessageKind = z.infer<typeof staffMessageKind>;

export const staffMessageEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status_changed'), from: status, to: status }),
  z.object({ type: z.literal('taken') }),
  z.object({ type: z.literal('assigned'), to: nameRef.nullable() }),
  z.object({ type: z.literal('reopened') }),
]);
export type StaffMessageEvent = z.infer<typeof staffMessageEvent>;

export const staffMessage = z.object({
  id,
  kind: staffMessageKind,
  /** null for events. */
  body: z.string().nullable(),
  /** Who wrote it or did it; null for system events. */
  author: z.object({ id, name: z.string(), isStaff: z.boolean() }).nullable(),
  /** For kind `event` only. */
  event: staffMessageEvent.nullable(),
  /** A Staff reply that was emailed to the opener. */
  emailed: z.boolean(),
  createdAt: isoDateTime,
});
export type StaffMessage = z.infer<typeof staffMessage>;

export const staffTicketSummary = ticketSummary.extend({
  business: nameRef,
  assignee: nameRef.nullable(),
  waitingSince: isoDateTime.nullable(),
  /** Wall-clock minutes waiting, for Tickets in the Waiting queue; null otherwise. */
  waitMinutes: z.int().nonnegative().nullable(),
  unreadCustomerReply: z.boolean(),
  /** Send it back with take, assign and status changes (409 VERSION_CONFLICT when stale). */
  version: z.int().nonnegative(),
});
export type StaffTicketSummary = z.infer<typeof staffTicketSummary>;

export const staffRunRef = runRef.extend({
  attempt: z.int().min(1),
  lastError: z.string().nullable(),
});
export type StaffRunRef = z.infer<typeof staffRunRef>;

export const memberRole = z.enum(['owner', 'member']);
export type MemberRole = z.infer<typeof memberRole>;

export const staffTicketDetail = staffTicketSummary.extend({
  /** Oldest first, Internal notes and every event included. */
  messages: z.array(staffMessage),
  run: staffRunRef.nullable(),
  context: z.object({
    pagePath: z.string().nullable(),
    balanceAtOpen: credits.nullable(),
    balanceNow: credits,
    openedByRole: memberRole,
    /** Tickets of this Business not closed. */
    businessOpenTickets: z.int().nonnegative(),
  }),
  firstStaffReplyAt: isoDateTime.nullable(),
  businessMinutesToFirstReply: z.int().nonnegative().nullable(),
  reopenUntil: isoDateTime.nullable(),
});
export type StaffTicketDetail = z.infer<typeof staffTicketDetail>;

// Error bodies with details ------------------------------------------------------------------------

/** 422 OPEN_TICKET_LIMIT: `details: { limit: 5 }`. */
export const openTicketLimitError = z.object({
  error: z.object({
    code: z.literal('OPEN_TICKET_LIMIT'),
    message: z.string(),
    details: z.object({ limit: z.int() }),
  }),
});
export type OpenTicketLimitError = z.infer<typeof openTicketLimitError>;

/** 409 TICKET_CLOSED_TOO_LONG: `details: { closedAt }`. */
export const ticketClosedTooLongError = z.object({
  error: z.object({
    code: z.literal('TICKET_CLOSED_TOO_LONG'),
    message: z.string(),
    details: z.object({ closedAt: isoDateTime }),
  }),
});
export type TicketClosedTooLongError = z.infer<typeof ticketClosedTooLongError>;

/** 409 VERSION_CONFLICT: `details: { ticket }`, the current Ticket. */
export const versionConflictError = z.object({
  error: z.object({
    code: z.literal('VERSION_CONFLICT'),
    message: z.string(),
    details: z.object({ ticket: staffTicketDetail }),
  }),
});
export type VersionConflictError = z.infer<typeof versionConflictError>;

// Customer endpoints (auth `session`) -------------------------------------------------------------

export const ticketListFilter = z.enum(['open', 'closed', 'all']);
export type TicketListFilter = z.infer<typeof ticketListFilter>;

/** FR-1. Open: not closed, by `lastMessageAt` desc; then closed by `closedAt` desc. */
export const listTickets = defineContract({
  method: 'GET',
  path: '/api/support/tickets',
  auth: 'session',
  status: 200,
  query: listQuery(TICKETS_PAGE_SIZE).extend({ status: ticketListFilter.default('open') }),
  response: z.object({
    items: z.array(ticketSummary),
    counts: z.object({ open: z.int().nonnegative(), closed: z.int().nonnegative() }),
    /** The Owner's view shows a From column. */
    showFrom: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
});

export const createTicketBody = z.object({
  category,
  subject: z
    .string()
    .trim()
    .min(SUBJECT_MIN)
    .max(SUBJECT_MAX)
    // One line: it goes into email subject headers (review #7).
    .regex(/^[^\p{Cc}]*$/u, 'Use a single line without control characters'),
  message: z.string().trim().min(MESSAGE_MIN).max(MESSAGE_MAX),
  runId: id.optional(),
  source: source.default('help'),
  /** The page the Member came from; stored only if it starts with `/app/`. */
  pagePath: z.string().max(PAGE_PATH_MAX).optional(),
});
export type CreateTicketBody = z.infer<typeof createTicketBody>;

/**
 * FR-2. 201, or 200 with the existing Ticket for a duplicate within 60 s. Outbox `TicketOpened`;
 * analytics `ticket_opened`.
 */
export const createTicket = defineContract({
  method: 'POST',
  path: '/api/support/tickets',
  auth: 'session',
  status: 201,
  body: createTicketBody,
  response: ticketDetail,
  errors: [
    err(403, 'NOT_WHILE_ACTING_AS'),
    err(404, 'UNKNOWN_RUN'),
    err(422, 'OPEN_TICKET_LIMIT'),
    err(429, 'TOO_MANY_REQUESTS'),
  ],
});

/** FR-4. */
export const getTicket = defineContract({
  method: 'GET',
  path: '/api/support/tickets/:number',
  auth: 'session',
  status: 200,
  params: ticketParams,
  response: ticketDetail,
  errors: [err(404, 'TICKET_NOT_FOUND')],
});

export const replyBody = z.object({ message: text });
export type ReplyBody = z.infer<typeof replyBody>;

/** FR-4. Reopens a closed Ticket within 30 days. Outbox `CustomerReplied`. */
export const replyToTicket = defineContract({
  method: 'POST',
  path: '/api/support/tickets/:number/replies',
  auth: 'session',
  status: 201,
  params: ticketParams,
  body: replyBody,
  response: ticketDetail,
  errors: [
    err(403, 'NOT_WHILE_ACTING_AS'),
    err(404, 'TICKET_NOT_FOUND'),
    err(409, 'TICKET_CLOSED_TOO_LONG'),
    err(429, 'TOO_MANY_REQUESTS'),
  ],
});

/** FR-5. No email. */
export const closeTicket = defineContract({
  method: 'POST',
  path: '/api/support/tickets/:number/close',
  auth: 'session',
  status: 200,
  params: ticketParams,
  /** `{}`; an empty request body is accepted too. */
  body: z.object({}).nullish(),
  response: ticketDetail,
  errors: [
    err(403, 'NOT_WHILE_ACTING_AS'),
    err(404, 'TICKET_NOT_FOUND'),
    err(409, 'ALREADY_CLOSED'),
  ],
});

/** FR-2. The run picker: runs started in the last 90 days, newest first, at most 50. */
export const listSupportRuns = defineContract({
  method: 'GET',
  path: '/api/support/runs',
  auth: 'session',
  status: 200,
  response: z.object({ items: z.array(runRef).max(RUN_PICKER_LIMIT) }),
});

// Staff endpoints (auth `staff`) ------------------------------------------------------------------

export const staffView = z.enum(['waiting', 'mine', 'waiting_on_customer', 'closed', 'all']);
export type StaffView = z.infer<typeof staffView>;

/** `me`, `nobody` or a Staff Member's id. */
export const assigneeFilter = z.union([z.literal('me'), z.literal('nobody'), id]);
export type AssigneeFilter = z.infer<typeof assigneeFilter>;

/** FR-6. Stats over Tickets opened in the last 30 days; null when there are none. */
export const listStaffTickets = defineContract({
  method: 'GET',
  path: '/api/staff/support/tickets',
  auth: 'staff',
  status: 200,
  query: listQuery(TICKETS_PAGE_SIZE).extend({
    view: staffView.default('waiting'),
    category: category.optional(),
    assignee: assigneeFilter.optional(),
  }),
  response: z.object({
    items: z.array(staffTicketSummary),
    counts: z.object({
      waiting: z.int().nonnegative(),
      mine: z.int().nonnegative(),
      waitingOnCustomer: z.int().nonnegative(),
    }),
    stats: z.object({
      waiting: z.int().nonnegative(),
      longestWaitMinutes: z.int().nonnegative().nullable(),
      firstReplyMedianBusinessMinutes30d: z.int().nonnegative().nullable(),
      closedWithin3DaysPct30d: z.int().min(0).max(100).nullable(),
    }),
    nextCursor: z.string().nullable(),
  }),
});

/** FR-6. The nav badge, refetched every 60 s. */
export const getWaitingCount = defineContract({
  method: 'GET',
  path: '/api/staff/support/count',
  auth: 'staff',
  status: 200,
  response: z.object({ waiting: z.int().nonnegative() }),
});

export const staffMemberRef = z.object({ id, name: z.string(), email });
export type StaffMemberRef = z.infer<typeof staffMemberRef>;

/** FR-8. The assignee picker. */
export const listSupportStaff = defineContract({
  method: 'GET',
  path: '/api/staff/support/staff',
  auth: 'staff',
  status: 200,
  response: z.object({ items: z.array(staffMemberRef) }),
});

/** FR-7. The assignee viewing marks customer replies read; audit `support.ticket_viewed`. */
export const getStaffTicket = defineContract({
  method: 'GET',
  path: '/api/staff/support/tickets/:number',
  auth: 'staff',
  status: 200,
  params: ticketParams,
  response: staffTicketDetail,
  errors: [err(404, 'TICKET_NOT_FOUND')],
});

const versionField = z.int().nonnegative();

export const takeBody = z.object({ version: versionField });
export type TakeBody = z.infer<typeof takeBody>;

/** FR-8. Audit `support.taken`. */
export const takeTicket = defineContract({
  method: 'POST',
  path: '/api/staff/support/tickets/:number/take',
  auth: 'staff',
  status: 200,
  params: ticketParams,
  body: takeBody,
  response: staffTicketDetail,
  errors: [err(404, 'TICKET_NOT_FOUND'), err(409, 'VERSION_CONFLICT'), err(409, 'TICKET_CLOSED')],
});

export const assignBody = z.object({ version: versionField, assigneeId: id.nullable() });
export type AssignBody = z.infer<typeof assignBody>;

/** FR-8. `null` = nobody (back to Waiting). Audit `support.assigned`. */
export const assignTicket = defineContract({
  method: 'POST',
  path: '/api/staff/support/tickets/:number/assign',
  auth: 'staff',
  status: 200,
  params: ticketParams,
  body: assignBody,
  response: staffTicketDetail,
  errors: [err(404, 'TICKET_NOT_FOUND'), err(404, 'UNKNOWN_STAFF'), err(409, 'VERSION_CONFLICT')],
});

export const setStatusBody = z.object({ version: versionField, status });
export type SetStatusBody = z.infer<typeof setStatusBody>;

/**
 * FR-9. `closed` = Close (outbox `TicketClosed`); another status on a closed Ticket within the
 * window reopens it. Audit `support.status_changed` / `support.closed` / `support.reopened`.
 */
export const setTicketStatus = defineContract({
  method: 'POST',
  path: '/api/staff/support/tickets/:number/status',
  auth: 'staff',
  status: 200,
  params: ticketParams,
  body: setStatusBody,
  response: staffTicketDetail,
  errors: [
    err(404, 'TICKET_NOT_FOUND'),
    err(409, 'VERSION_CONFLICT'),
    err(409, 'TICKET_CLOSED_TOO_LONG'),
  ],
});

/** After the reply: Reply & wait on customer, or Close (one email containing both). */
export const replyThen = z.enum(['wait_on_customer', 'close']);
export type ReplyThen = z.infer<typeof replyThen>;

export const staffReplyBody = z.object({ message: text, then: replyThen.optional() });
export type StaffReplyBody = z.infer<typeof staffReplyBody>;

/** FR-9. No version needed. Outbox `StaffReplied` (or `TicketClosed` with `then: close`). */
export const staffReplyToTicket = defineContract({
  method: 'POST',
  path: '/api/staff/support/tickets/:number/replies',
  auth: 'staff',
  status: 201,
  params: ticketParams,
  body: staffReplyBody,
  response: staffTicketDetail,
  errors: [err(404, 'TICKET_NOT_FOUND'), err(409, 'TICKET_CLOSED_TOO_LONG')],
});

export const noteBody = z.object({ note: text });
export type NoteBody = z.infer<typeof noteBody>;

/** FR-10. Staff only; no status change, no email. Audit `support.note_added`. */
export const addInternalNote = defineContract({
  method: 'POST',
  path: '/api/staff/support/tickets/:number/notes',
  auth: 'staff',
  status: 201,
  params: ticketParams,
  body: noteBody,
  response: staffTicketDetail,
  errors: [err(404, 'TICKET_NOT_FOUND')],
});

// Test hooks (registered only when NODE_ENV=test) ---------------------------------------------------

/** AJ-4. Back-dates `closedAt` by `days` (the Ticket must be closed). */
export const closeTicketAgo = defineContract({
  method: 'POST',
  path: '/api/test/support/close-ago',
  auth: 'public',
  status: 200,
  body: z.object({ number: ticketNumber, days: z.int().min(0).max(3650) }),
  response: z.object({ number: ticketNumber, closedAt: isoDateTime }),
  errors: [err(404, 'TICKET_NOT_FOUND')],
});

/** AJ-6. Creates open Tickets until the Business has `count` not closed (default the limit). */
export const fillOpenTickets = defineContract({
  method: 'POST',
  path: '/api/test/support/fill-open',
  auth: 'public',
  status: 200,
  body: z.object({ businessId: id, count: z.int().min(1).max(OPEN_TICKET_LIMIT) }),
  /** The numbers created (empty when the Business already had `count`). */
  response: z.object({ numbers: z.array(ticketNumber) }),
  errors: [err(404, 'NOT_FOUND')],
});

export const supportContracts = {
  listTickets,
  createTicket,
  getTicket,
  replyToTicket,
  closeTicket,
  listSupportRuns,
  listStaffTickets,
  getWaitingCount,
  listSupportStaff,
  getStaffTicket,
  takeTicket,
  assignTicket,
  setTicketStatus,
  staffReplyToTicket,
  addInternalNote,
} as const;

/** Test-only endpoints, kept out of `supportContracts` (never in production). */
export const supportTestContracts = { closeTicketAgo, fillOpenTickets } as const;
