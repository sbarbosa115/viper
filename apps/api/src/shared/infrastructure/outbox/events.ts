/**
 * Events that cross module boundaries through the outbox (ADR 0008). Payloads carry ids, never
 * personal data. Add an event here when a module needs one; consumers must be idempotent
 * (delivery is at least once).
 */
export interface OutboxEvents {
  /** identity → billing grants the trial credits (FR-2, FR-11). */
  MemberEmailVerified: { memberId: string; businessId: string };
  /** research: the worker picks the run up (FR-18). */
  RunRequested: { runId: string; businessId: string };
  /** research → email and analytics (FR-22). */
  RunCompleted: RunEnded;
  RunFailed: RunEnded & { failureCode: string };
  RunCancelled: RunEnded;
  /** billing → analytics (FR-12). */
  CreditPackPurchased: {
    purchaseId: string;
    businessId: string;
    packId: string;
    credits: number;
    amountCents: number;
  };
  /** finance → budget alert email to every Staff Member (prd-expenses FR-12). */
  BudgetAlertRecorded: { month: string; threshold: 80 | 100 };
  /** support → ticket emails (prd-support FR-11); payloads mirror SupportOutboxEvents. */
  TicketOpened: SupportTicketEvent & { messageId: string };
  CustomerReplied: SupportTicketEvent & {
    messageId: string;
    /** The status right after the reply (the email shows it, not the status at send time). */
    status: 'open' | 'in_progress' | 'waiting_on_customer' | 'closed';
  };
  StaffReplied: SupportTicketEvent & { messageId: string };
  TicketClosed: SupportTicketEvent & { messageId: string | null; closedBy: 'customer' | 'staff' };
}

interface SupportTicketEvent {
  ticketId: string;
  ticketNumber: number;
  businessId: string;
  openedByMemberId: string;
  assigneeId: string | null;
}

interface RunEnded {
  runId: string;
  businessId: string;
  planId: string;
  /** Set when Staff started the run while Acting as: no customer email (FR-22). */
  startedByStaffId: string | null;
}

export type OutboxEventType = keyof OutboxEvents;

/** What a consumer's BullMQ job receives (`job.name` is the event type, `job.id` the event id). */
export interface OutboxMessage<K extends OutboxEventType = OutboxEventType> {
  eventId: string;
  type: K;
  payload: OutboxEvents[K];
  occurredAt: string;
}

/** A queue that wants an event type. Modules export these; the relay routes by them. */
export interface OutboxSubscription {
  readonly event: OutboxEventType;
  readonly queue: string;
}
