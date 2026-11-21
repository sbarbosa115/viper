/**
 * support's domain core, for the application packages (customer, Staff, notifications):
 * - ticket.ts: the Ticket aggregate, its pure commands and `outboxEvents`.
 * - rules.ts: visibility, Acting as, the waiting rule, limits, the view-audit day.
 * - listing.ts: list queries, orderings, cursors, previews and the stats strip.
 * - business-time.ts: `businessMinutesBetween` (Mon–Fri 09–17 America/Chicago) and `median`.
 * - errors.ts: every support error code as a CodedError.
 * - repository.ts: the `SupportStore` / `TicketRepository` ports.
 */
export * from './business-time.js';
export * from './errors.js';
export * from './listing.js';
export * from './repository.js';
export * from './rules.js';
export * from './ticket.js';
