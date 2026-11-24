import type { ColumnType, Generated } from 'kysely';
import type { DefaultedBool, Timestamp } from '../../../shared/infrastructure/db/schema.js';

/** support's tables (prd-support section 8; migration 20261121100100_support_init). */

export type TicketCategoryColumn = 'billing' | 'run' | 'account' | 'bug' | 'other';
export type TicketStatusColumn = 'open' | 'in_progress' | 'waiting_on_customer' | 'closed';
export type TicketSourceColumn = 'help' | 'run' | 'leads';
export type TicketSideColumn = 'customer' | 'staff';
export type SupportMessageKindColumn = 'customer_reply' | 'staff_reply' | 'internal_note' | 'event';

/** `support_messages.event` for kind `event` (status changes, take, assign, reopen). */
export interface SupportEventColumn {
  type: 'status_changed' | 'taken' | 'assigned' | 'reopened';
  from?: TicketStatusColumn;
  to?: TicketStatusColumn;
  /** `assigned`: the new assignee, null for nobody. */
  assigneeId?: string | null;
}

/** A nullable DATETIME(3) that inserts may omit. */
type OptionalTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;

export interface SupportTicketsTable {
  id: string;
  /** AUTO_INCREMENT from 1001, unique; shown as `#1042`. */
  number: Generated<number>;
  business_id: string;
  opened_by_member_id: string;
  category: TicketCategoryColumn;
  subject: string;
  status: TicketStatusColumn;
  assignee_member_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** A research run id; no FK across contexts. */
  run_id: ColumnType<string | null, string | null | undefined, string | null>;
  source: TicketSourceColumn;
  page_path: ColumnType<string | null, string | null | undefined, string | null>;
  /** Credits at the moment the Ticket was opened. */
  balance_at_open: ColumnType<number | null, number | null | undefined, number | null>;
  /** Optimistic concurrency: `UPDATE … WHERE id = ? AND version = ?`, +1 per change. */
  version: Generated<number>;
  waiting_since: OptionalTimestamp;
  first_staff_reply_at: OptionalTimestamp;
  last_message_at: Timestamp;
  last_message_by: TicketSideColumn;
  closed_at: OptionalTimestamp;
  closed_by: ColumnType<
    TicketSideColumn | null,
    TicketSideColumn | null | undefined,
    TicketSideColumn | null
  >;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** Immutable: no edits or deletes (except by the Business cascade). */
export interface SupportMessagesTable {
  id: string;
  ticket_id: string;
  kind: SupportMessageKindColumn;
  author_member_id: string | null;
  /** Plain text, ≤ 10,000 characters; null for events. */
  body: string | null;
  /** Write `JSON.stringify(event)`, or null (omitted) for replies and notes. */
  event: ColumnType<SupportEventColumn | null, string | null | undefined, string | null>;
  emailed: DefaultedBool;
  created_at: Timestamp;
}

/** When each Member last viewed a Ticket (read state and the once-per-day view audit). */
export interface SupportTicketViewsTable {
  ticket_id: string;
  member_id: string;
  last_viewed_at: Timestamp;
}

export interface SupportTables {
  support_tickets: SupportTicketsTable;
  support_messages: SupportMessagesTable;
  support_ticket_views: SupportTicketViewsTable;
}
