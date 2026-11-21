import type { RunRef } from '@app/contracts/support';
import type { AnalyticsTracker } from '../../shared/application/analytics-tracker.js';
import type { EventPublisher } from '../../shared/application/event-publisher.js';

/**
 * support reads other contexts only through these ports (prd-support section 7, module ports);
 * composition.ts adapts the owning modules' public functions to them. Ids are UUID strings.
 */

// identity ----------------------------------------------------------------------------------------

export interface MemberSummary {
  id: string;
  name: string;
  email: string;
  businessId: string;
  role: 'owner' | 'member';
  isStaff: boolean;
}

export interface StaffMemberSummary {
  id: string;
  name: string;
  email: string;
}

export interface StaffRecipient {
  memberId: string;
  email: string;
  name: string;
}

export interface BusinessName {
  id: string;
  name: string;
}

export interface IdentityForSupport {
  /** Members by id, in one batch; unknown ids are left out. */
  memberSummaries(ids: readonly string[]): Promise<MemberSummary[]>;
  /** Every Staff Member (the assignee picker, UNKNOWN_STAFF checks). */
  staffMembers(): Promise<StaffMemberSummary[]>;
  /** Every Staff Member as an email recipient (identity's existing `staffRecipients`). */
  staffRecipients(): Promise<StaffRecipient[]>;
  /** Business names by id, in one batch; unknown ids are left out. */
  businessNames(ids: readonly string[]): Promise<BusinessName[]>;
}

// research ----------------------------------------------------------------------------------------

/** A run with what the Staff ticket view and the ownership check need. */
export type SupportRun = RunRef & { businessId: string; attempt: number; lastError: string | null };

export interface ResearchForSupport {
  /** The Business's runs started at or after `since`, newest first, at most `limit`. */
  recentRunsForBusiness(businessId: string, since: Date, limit: number): Promise<RunRef[]>;
  /** One run of any Business; null when it doesn't exist. */
  runForSupport(runId: string): Promise<SupportRun | null>;
}

// billing -----------------------------------------------------------------------------------------

export interface BillingForSupport {
  /** The Business's credit balance (the header balance). */
  balanceFor(businessId: string): Promise<number>;
}

// platform ----------------------------------------------------------------------------------------

/** Audit log actions support writes (FR-12), every one with `details.ticketNumber`. */
export type SupportAuditAction =
  | 'support.ticket_viewed'
  | 'support.taken'
  | 'support.assigned'
  | 'support.status_changed'
  | 'support.replied'
  | 'support.note_added'
  | 'support.closed'
  | 'support.reopened';

export interface SupportAuditRecord {
  staffMemberId: string;
  /** The Ticket's Business. */
  businessId: string;
  action: SupportAuditAction;
  targetType: 'support_ticket';
  /** The Ticket id. */
  targetId: string;
  details: { ticketNumber: number } & Record<string, unknown>;
}

/** platform's Audit log (structurally its AuditRecorder); `within` is the open transaction. */
export interface SupportAudit {
  record(entry: SupportAuditRecord, within?: object): Promise<void>;
}

export type { AnalyticsTracker };

// Outbox events (FR-11) ---------------------------------------------------------------------------

/**
 * What every support event carries: ids only, never personal data or message text (the email
 * consumer reads the Ticket and message). The event id is the outbox envelope's `eventId`.
 */
export interface TicketEventBase {
  ticketId: string;
  ticketNumber: number;
  businessId: string;
  openedByMemberId: string;
  /** The assignee when the event happened; null when unassigned. */
  assigneeId: string | null;
}

/**
 * support's outbox events, consumed by the `support` queue for the four emails. The orchestrator
 * adds them to `OutboxEvents` (shared/infrastructure/outbox/events.ts).
 */
export interface SupportOutboxEvents {
  /** A new Ticket → "New ticket" to every Staff Member. `messageId`: the first message. */
  TicketOpened: TicketEventBase & { messageId: string };
  /** A customer reply → the assignee, or every Staff Member when unassigned. */
  CustomerReplied: TicketEventBase & { messageId: string };
  /** A Staff reply (not a close) → the opener. */
  StaffReplied: TicketEventBase & { messageId: string };
  /**
   * A close → the opener, only when `closedBy` is `staff`. `messageId`: the closing reply sent
   * with it (one email for both), or null.
   */
  TicketClosed: TicketEventBase & { messageId: string | null; closedBy: 'customer' | 'staff' };
}

export type SupportEventType = keyof SupportOutboxEvents;

export const SUPPORT_EVENT_TYPES: readonly SupportEventType[] = [
  'TicketOpened',
  'CustomerReplied',
  'StaffReplied',
  'TicketClosed',
];

/** The UoW-bound publisher support's use cases depend on. */
export type SupportEventPublisher = EventPublisher<SupportOutboxEvents>;
