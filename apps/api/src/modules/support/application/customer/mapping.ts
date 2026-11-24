import {
  SUPPORT_AUTHOR_NAME,
  type CustomerMessage,
  type RunRef,
  type TicketDetail,
  type TicketSummary,
} from '@app/contracts/support';
import {
  canReopen,
  isReadOnly,
  previewText,
  reopenUntil,
  type Ticket,
  type TicketMessage,
  type TicketPreview,
} from '../../domain/index.js';
import type { Actor } from '../../../../shared/domain/actor.js';
import type { MemberSummary } from '../../ports.js';
import type { CustomerSupportDeps } from './deps.js';

/** Shown where a Member can no longer be resolved. */
const UNKNOWN_MEMBER = 'Former member';

export interface Names {
  member(id: string | null): string;
}

export async function loadNames(
  deps: Pick<CustomerSupportDeps, 'identity'>,
  ids: readonly (string | null)[],
): Promise<Names> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  const found: MemberSummary[] =
    wanted.length > 0 ? await deps.identity.memberSummaries(wanted) : [];
  const byId = new Map(found.map((m) => [m.id, m.name]));
  return { member: (id) => (id ? (byId.get(id) ?? UNKNOWN_MEMBER) : UNKNOWN_MEMBER) };
}

/** The last reply of a thread (not events or notes), oldest-first input. */
export function lastReplyOf(messages: readonly TicketMessage[]): TicketPreview | null {
  const reply = messages.findLast((m) => m.kind === 'customer_reply' || m.kind === 'staff_reply');
  if (!reply?.body) return null;
  return {
    side: reply.kind === 'staff_reply' ? 'staff' : 'customer',
    authorMemberId: reply.authorMemberId,
    text: reply.body,
  };
}

export function toSummary(
  ticket: Ticket,
  lastReply: TicketPreview | null,
  names: Names,
  run: Pick<RunRef, 'id' | 'planName'> | null,
): TicketSummary {
  return {
    number: ticket.number,
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    source: ticket.source,
    openedBy: { id: ticket.openedByMemberId, name: names.member(ticket.openedByMemberId) },
    preview: lastReply
      ? {
          author: lastReply.side === 'staff' ? 'support' : 'customer',
          authorName:
            lastReply.side === 'staff'
              ? SUPPORT_AUTHOR_NAME
              : names.member(lastReply.authorMemberId),
          text: previewText(lastReply.text),
        }
      : null,
    run: run ? { id: run.id, planName: run.planName } : null,
    lastMessageAt: ticket.lastMessageAt.toISOString(),
    closedAt: ticket.closedAt?.toISOString() ?? null,
    createdAt: ticket.createdAt.toISOString(),
  };
}

/** What a customer may see of a thread: replies and status events. Notes and assignment never. */
export function toCustomerMessages(
  messages: readonly TicketMessage[],
  names: Names,
): CustomerMessage[] {
  const out: CustomerMessage[] = [];
  for (const m of messages) {
    const createdAt = m.createdAt.toISOString();
    if (m.kind === 'customer_reply' && m.authorMemberId) {
      out.push({
        id: m.id,
        kind: 'customer_reply',
        body: m.body,
        author: { kind: 'member', id: m.authorMemberId, name: names.member(m.authorMemberId) },
        status: null,
        createdAt,
      });
    } else if (m.kind === 'staff_reply') {
      out.push({
        id: m.id,
        kind: 'staff_reply',
        body: m.body,
        author: { kind: 'support', name: SUPPORT_AUTHOR_NAME },
        status: null,
        createdAt,
      });
    } else if (m.kind === 'event' && m.event?.type === 'status_changed') {
      out.push({
        id: m.id,
        kind: 'status_event',
        body: null,
        author: null,
        status: m.event.to,
        createdAt,
      });
    }
  }
  return out;
}

/** The thread page: the Ticket, its visible messages, the linked run and what the viewer can do. */
export async function toDetail(
  deps: CustomerSupportDeps,
  actor: Actor,
  ticket: Ticket,
): Promise<TicketDetail> {
  const [messages, run] = await Promise.all([
    deps.store.read.messages(ticket.id),
    ticket.runId ? deps.research.runForSupport(ticket.runId) : Promise.resolve(null),
  ]);
  const names = await loadNames(deps, [
    ticket.openedByMemberId,
    ...messages.map((m) => m.authorMemberId),
  ]);
  const readOnly = isReadOnly(actor);
  const until = reopenUntil(ticket);
  const runRef: RunRef | null = run
    ? {
        id: run.id,
        planId: run.planId,
        planName: run.planName,
        startedAt: run.startedAt,
        status: run.status,
        stoppedStep: run.stoppedStep,
        creditsCharged: run.creditsCharged,
      }
    : null;
  return {
    ...toSummary(ticket, lastReplyOf(messages), names, runRef),
    run: runRef,
    messages: toCustomerMessages(messages, names),
    canReply: !readOnly && canReopen(ticket, deps.clock.now()),
    canClose: !readOnly && ticket.status !== 'closed',
    reopenUntil: until?.toISOString() ?? null,
    readOnly,
  };
}
