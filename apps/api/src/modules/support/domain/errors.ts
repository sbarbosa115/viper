import { OPEN_TICKET_LIMIT } from '@app/contracts/support';
import { CodedError } from '../../../shared/domain/errors.js';

/**
 * support's error codes (prd-support sections 6 and 7). Each is a `CodedError` with the status its
 * contract documents, so the central error handler answers with the right code and status.
 */
export const supportErrors = {
  /** 404, also for Tickets the Member may not see (never 403, so numbers can't be probed). */
  ticketNotFound: () => new CodedError('TICKET_NOT_FOUND', 'Ticket not found', undefined, 404),
  /** 422: the Business already has 5 Tickets not closed. `details: { limit }`. */
  openTicketLimit: () =>
    new CodedError(
      'OPEN_TICKET_LIMIT',
      `You have ${OPEN_TICKET_LIMIT} open tickets. Reply on one of them or close one first.`,
      { limit: OPEN_TICKET_LIMIT },
      422,
    ),
  /** 409: a reply (or reopening status) more than 30 days after `closedAt`. `details: { closedAt }`. */
  ticketClosedTooLong: (closedAt: Date) =>
    new CodedError(
      'TICKET_CLOSED_TOO_LONG',
      'This ticket was closed more than 30 days ago. Open a new ticket.',
      { closedAt: closedAt.toISOString() },
      409,
    ),
  /** 409: the customer closes a Ticket that is already closed. */
  alreadyClosed: () =>
    new CodedError('ALREADY_CLOSED', 'This ticket is already closed.', undefined, 409),
  /** 409: Take it on a closed Ticket. */
  ticketClosed: () =>
    new CodedError('TICKET_CLOSED', "A closed ticket can't be taken.", undefined, 409),
  /**
   * 409: the Ticket changed since the caller read it. The Staff use case replaces `details` with
   * `{ ticket }` (the current staffTicketDetail) before it reaches HTTP; see `isVersionConflict`.
   */
  versionConflict: (ticketNumber: number) =>
    new CodedError(
      'VERSION_CONFLICT',
      "Someone changed this ticket. Here's the latest.",
      { ticketNumber },
      409,
    ),
  /** 403: customer writes while Staff are Acting as the Business. */
  notWhileActingAs: () =>
    new CodedError(
      'NOT_WHILE_ACTING_AS',
      'Not available while Acting as a Business.',
      undefined,
      403,
    ),
  /** 429 with `details.retryAfterSeconds` (the route sets `Retry-After`). */
  tooManyRequests: (retryAfterSeconds: number) =>
    new CodedError('TOO_MANY_REQUESTS', 'Too many requests. Try again later.', {
      retryAfterSeconds,
    }),
  /** 404: the run isn't the Business's or is older than 90 days. */
  unknownRun: () => new CodedError('UNKNOWN_RUN', 'Run not found', undefined, 404),
  /** 404: the assignee isn't a Staff Member. */
  unknownStaff: () => new CodedError('UNKNOWN_STAFF', 'Staff Member not found', undefined, 404),
} as const;

export function isVersionConflict(error: unknown): error is CodedError {
  return error instanceof CodedError && error.code === 'VERSION_CONFLICT';
}
