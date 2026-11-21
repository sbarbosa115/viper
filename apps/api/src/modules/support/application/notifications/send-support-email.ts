import type { EmailSender } from '../../../../shared/application/email-sender.js';
import type { SupportStore, Ticket } from '../../domain/index.js';
import {
  customerRepliedEmail,
  staffRepliedEmail,
  ticketClosedEmail,
  ticketOpenedEmail,
} from '../../email/support-emails.js';
import type { IdentityForSupport, ResearchForSupport, SupportOutboxEvents } from '../../ports.js';

export interface NotificationLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface SupportEmailDeps {
  store: Pick<SupportStore, 'read'>;
  identity: IdentityForSupport;
  research: Pick<ResearchForSupport, 'runForSupport'>;
  email: EmailSender;
  appUrl: string;
  logger: NotificationLogger;
}

/** Recipients already emailed for this event, kept in the job's progress across retries. */
export interface DeliveryProgress {
  delivered: readonly string[];
  save(delivered: readonly string[]): Promise<unknown>;
}

/** An outbox message of one of the four support events (the shape of the relay's job data). */
export type SupportEmailMessage = {
  [K in keyof SupportOutboxEvents]: {
    eventId: string;
    type: K;
    payload: SupportOutboxEvents[K];
    occurredAt: string;
  };
}[keyof SupportOutboxEvents];

interface Recipient {
  memberId: string;
  email: string;
  name: string;
}

/**
 * FR-11: turns one outbox event into its email(s). A failed send throws, so BullMQ retries the
 * job (the relay's 5 tries with exponential backoff); recipients already emailed are skipped on
 * a retry and a Staff reply already marked `emailed` is not sent twice (NFR-4). Skips (logged)
 * when the Ticket, the message or the recipient no longer exists.
 */
export class SendSupportEmail {
  constructor(private readonly deps: SupportEmailDeps) {}

  async execute(message: SupportEmailMessage, progress?: DeliveryProgress): Promise<void> {
    const { payload } = message;
    const repo = this.deps.store.read;
    const ticket = await repo.findById(payload.ticketId);
    if (!ticket) return this.skip(message, 'ticket not found');
    const body = await this.bodyOf(message);
    if (body === 'missing') return this.skip(message, 'message not found');

    const delivered = new Set(progress?.delivered ?? []);
    const isReplyToOpener = message.type === 'StaffReplied' || message.type === 'TicketClosed';
    if (isReplyToOpener && body?.emailed) return;
    if (message.type === 'TicketClosed' && message.payload.closedBy === 'customer') return;

    const recipients = await this.recipients(message, ticket);
    if (recipients.length === 0) return;
    const render = await this.renderer(message, ticket, body?.text ?? null);
    for (const r of recipients) {
      if (delivered.has(r.memberId)) continue;
      await this.deps.email.send(render(r));
      delivered.add(r.memberId);
      await progress?.save([...delivered]);
    }
    if (isReplyToOpener && body) await this.deps.store.read.markEmailed(body.id);
  }

  private skip(message: SupportEmailMessage, reason: string): void {
    this.deps.logger.warn(
      { eventId: message.eventId, type: message.type, ticketId: message.payload.ticketId },
      `support email skipped: ${reason}`,
    );
  }

  private async bodyOf(
    message: SupportEmailMessage,
  ): Promise<{ id: string; text: string; emailed: boolean } | null | 'missing'> {
    const id = message.payload.messageId;
    if (!id) return null;
    const found = await this.deps.store.read.findMessage(id);
    const text = found?.body;
    if (!found || typeof text !== 'string') return 'missing';
    return { id, text, emailed: found.emailed };
  }

  private async recipients(message: SupportEmailMessage, ticket: Ticket): Promise<Recipient[]> {
    const { identity } = this.deps;
    const toMember = async (memberId: string, role: string): Promise<Recipient[]> => {
      const [m] = await identity.memberSummaries([memberId]);
      if (!m) {
        this.skip(message, `${role} no longer exists`);
        return [];
      }
      return [{ memberId: m.id, email: m.email, name: m.name }];
    };
    switch (message.type) {
      case 'TicketOpened':
        return identity.staffRecipients();
      case 'CustomerReplied':
        return message.payload.assigneeId
          ? toMember(message.payload.assigneeId, 'assignee')
          : identity.staffRecipients();
      case 'StaffReplied':
      case 'TicketClosed':
        return toMember(ticket.openedByMemberId, 'opener');
    }
  }

  private async renderer(
    message: SupportEmailMessage,
    ticket: Ticket,
    text: string | null,
  ): Promise<(to: Recipient) => ReturnType<typeof staffRepliedEmail>> {
    const { identity, research, appUrl } = this.deps;
    const [business] = await identity.businessNames([ticket.businessId]);
    const common = {
      appUrl,
      number: ticket.number,
      subject: ticket.subject,
      businessName: business?.name ?? 'Unknown business',
    };
    switch (message.type) {
      case 'TicketOpened': {
        const [opener] = await identity.memberSummaries([ticket.openedByMemberId]);
        const run = ticket.runId ? await research.runForSupport(ticket.runId) : null;
        return (to) =>
          ticketOpenedEmail({
            ...common,
            to: to.email,
            category: ticket.category,
            openedBy: { name: opener?.name ?? 'A former member', role: opener?.role ?? null },
            run: run ? { planName: run.planName, status: run.status } : null,
            message: text ?? '',
          });
      }
      case 'CustomerReplied':
        return (to) =>
          customerRepliedEmail({
            ...common,
            to: to.email,
            status: ticket.status,
            message: text ?? '',
          });
      case 'StaffReplied':
        return (to) => staffRepliedEmail({ ...common, to: to.email, message: text ?? '' });
      case 'TicketClosed':
        return (to) => ticketClosedEmail({ ...common, to: to.email, message: text });
    }
  }
}
