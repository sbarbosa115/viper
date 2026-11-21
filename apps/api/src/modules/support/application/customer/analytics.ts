import {
  minutesBetween,
  type Ticket,
  type TicketChange,
  type TicketMessage,
} from '../../domain/index.js';
import type { Actor } from '../../../../shared/domain/actor.js';
import type { AnalyticsEvent } from '../../../../shared/application/analytics-tracker.js';

const DAY_MS = 24 * 3600 * 1000;

/** What a customer command did, in prd-support section 3a terms (ids and counts, no text). */
export function customerChangeEvents(input: {
  actor: Actor;
  before: Ticket;
  change: TicketChange;
  /** The thread before the change; needed for `ticket_closed`. */
  messages: readonly TicketMessage[];
  now: Date;
}): AnalyticsEvent[] {
  const { actor, before, change, now } = input;
  const who = { memberId: actor.memberId, businessId: actor.businessId };
  const n = before.number;
  const out: AnalyticsEvent[] = [];
  for (const fact of change.facts) {
    switch (fact.type) {
      case 'customer_replied':
        out.push({
          name: 'ticket_replied',
          actor: who,
          properties: {
            ticket_number: n,
            by: 'customer',
            minutes_since_last: minutesBetween(before.lastMessageAt, now),
            is_first_staff_reply: false,
          },
        });
        break;
      case 'status_changed':
        out.push({
          name: 'ticket_status_changed',
          actor: who,
          properties: { ticket_number: n, from: fact.from, to: fact.to, by: fact.by },
        });
        break;
      case 'closed':
        out.push({
          name: 'ticket_closed',
          actor: who,
          properties: {
            ticket_number: n,
            by: fact.by,
            minutes_open: minutesBetween(before.createdAt, now),
            staff_replies: input.messages.filter((m) => m.kind === 'staff_reply').length,
            customer_replies: input.messages.filter((m) => m.kind === 'customer_reply').length,
          },
        });
        break;
      case 'reopened':
        out.push({
          name: 'ticket_reopened',
          actor: who,
          properties: {
            ticket_number: n,
            by: fact.by,
            days_since_closed: before.closedAt
              ? Math.floor((now.getTime() - before.closedAt.getTime()) / DAY_MS)
              : 0,
          },
        });
        break;
      default:
        break;
    }
  }
  return out;
}
