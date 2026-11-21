import {
  SUPPORT_AUTHOR_NAME,
  type StaffMessage,
  type StaffRunRef,
  type StaffTicketDetail,
  type StaffTicketSummary,
} from '@app/contracts/support';
import {
  businessMinutesBetween,
  hasUnreadCustomerReply,
  previewText,
  reopenUntil,
  waitMinutes,
  type SupportStore,
  type Ticket,
  type TicketListItem,
  type TicketMessage,
} from '../../domain/index.js';
import type { MemberSummary, SupportRun } from '../../ports.js';
import type { StaffSupportDeps } from './deps.js';

/** Who a Staff view names: members and Businesses looked up in batches, runs one per distinct id. */
export interface Lookups {
  members: Map<string, MemberSummary>;
  businesses: Map<string, string>;
  runs: Map<string, SupportRun>;
}

const UNKNOWN_MEMBER = 'Unknown member';

const unique = (ids: readonly (string | null | undefined)[]): string[] => [
  ...new Set(ids.filter((id): id is string => typeof id === 'string')),
];

export async function lookup(
  deps: Pick<StaffSupportDeps, 'identity' | 'research'>,
  input: {
    memberIds: readonly (string | null)[];
    businessIds: readonly string[];
    runIds: readonly (string | null)[];
  },
): Promise<Lookups> {
  const runIds = unique(input.runIds);
  const [members, businesses, runs] = await Promise.all([
    deps.identity.memberSummaries(unique(input.memberIds)),
    deps.identity.businessNames(unique(input.businessIds)),
    Promise.all(runIds.map((id) => deps.research.runForSupport(id))),
  ]);
  return {
    members: new Map(members.map((m) => [m.id, m])),
    businesses: new Map(businesses.map((b) => [b.id, b.name])),
    runs: new Map(runs.flatMap((r) => (r ? [[r.id, r] as const] : []))),
  };
}

const nameOf = (l: Lookups, id: string): string => l.members.get(id)?.name ?? UNKNOWN_MEMBER;

function summaryOf(item: TicketListItem, l: Lookups, now: Date): StaffTicketSummary {
  const t = item.ticket;
  const run = t.runId ? l.runs.get(t.runId) : undefined;
  const reply = item.lastReply;
  return {
    number: t.number,
    subject: t.subject,
    category: t.category,
    status: t.status,
    source: t.source,
    openedBy: { id: t.openedByMemberId, name: nameOf(l, t.openedByMemberId) },
    preview: reply
      ? {
          author: reply.side === 'staff' ? 'support' : 'customer',
          authorName:
            reply.side === 'staff'
              ? SUPPORT_AUTHOR_NAME
              : reply.authorMemberId
                ? nameOf(l, reply.authorMemberId)
                : UNKNOWN_MEMBER,
          text: reply.text,
        }
      : null,
    run: run ? { id: run.id, planName: run.planName } : null,
    lastMessageAt: t.lastMessageAt.toISOString(),
    closedAt: t.closedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    business: { id: t.businessId, name: l.businesses.get(t.businessId) ?? '' },
    assignee: t.assigneeId ? { id: t.assigneeId, name: nameOf(l, t.assigneeId) } : null,
    waitingSince: t.waitingSince?.toISOString() ?? null,
    waitMinutes: waitMinutes(t, now),
    unreadCustomerReply: hasUnreadCustomerReply(t),
    version: t.version,
  };
}

/** The list rows of a page, with their names looked up in batches. */
export async function summariesOf(
  deps: Pick<StaffSupportDeps, 'identity' | 'research'>,
  items: readonly TicketListItem[],
  now: Date,
): Promise<StaffTicketSummary[]> {
  const l = await lookup(deps, {
    memberIds: items.flatMap((i) => [
      i.ticket.openedByMemberId,
      i.ticket.assigneeId,
      i.lastReply?.authorMemberId ?? null,
    ]),
    businessIds: items.map((i) => i.ticket.businessId),
    runIds: items.map((i) => i.ticket.runId),
  });
  return items.map((item) => summaryOf(item, l, now));
}

function messageOf(m: TicketMessage, l: Lookups): StaffMessage {
  const author = m.authorMemberId ? l.members.get(m.authorMemberId) : undefined;
  const e = m.event;
  const assignee = e?.type === 'assigned' && e.assigneeId ? e.assigneeId : null;
  return {
    id: m.id,
    kind: m.kind,
    body: m.body,
    author: author ? { id: author.id, name: author.name, isStaff: author.isStaff } : null,
    event: !e
      ? null
      : e.type === 'assigned'
        ? { type: 'assigned', to: assignee ? { id: assignee, name: nameOf(l, assignee) } : null }
        : e.type === 'taken'
          ? { type: 'taken' }
          : { type: 'status_changed', from: e.from, to: e.to },
    emailed: m.emailed,
    createdAt: m.createdAt.toISOString(),
  };
}

function runOf(run: SupportRun): StaffRunRef {
  const { businessId: _businessId, ...ref } = run;
  return ref;
}

/** The whole Ticket for the Staff view (FR-7), read from the store outside any transaction. */
export async function detailOf(
  deps: StaffSupportDeps,
  store: SupportStore,
  ticket: Ticket,
): Promise<StaffTicketDetail> {
  const messages = await store.read.messages(ticket.id);
  const l = await lookup(deps, {
    memberIds: [
      ticket.openedByMemberId,
      ticket.assigneeId,
      ...messages.flatMap((m) => [
        m.authorMemberId,
        m.event?.type === 'assigned' ? m.event.assigneeId : null,
      ]),
    ],
    businessIds: [ticket.businessId],
    runIds: [ticket.runId],
  });
  const [balanceNow, businessOpenTickets] = await Promise.all([
    deps.billing.balanceFor(ticket.businessId),
    store.read.countOpenOfBusiness(ticket.businessId),
  ]);
  const now = deps.clock.now();
  const opener = l.members.get(ticket.openedByMemberId);
  const run = ticket.runId ? l.runs.get(ticket.runId) : undefined;
  const lastReply = [...messages]
    .reverse()
    .find((m) => m.kind === 'customer_reply' || m.kind === 'staff_reply');
  return {
    ...summaryOf(
      {
        ticket,
        lastReply: lastReply?.body
          ? {
              side: lastReply.kind === 'staff_reply' ? 'staff' : 'customer',
              authorMemberId: lastReply.authorMemberId,
              text: previewText(lastReply.body),
            }
          : null,
      },
      l,
      now,
    ),
    messages: messages.map((m) => messageOf(m, l)),
    run: run ? runOf(run) : null,
    context: {
      pagePath: ticket.pagePath,
      balanceAtOpen: ticket.balanceAtOpen,
      balanceNow,
      openedByRole: opener?.role ?? 'member',
      businessOpenTickets,
    },
    firstStaffReplyAt: ticket.firstStaffReplyAt?.toISOString() ?? null,
    businessMinutesToFirstReply: ticket.firstStaffReplyAt
      ? businessMinutesBetween(ticket.createdAt, ticket.firstStaffReplyAt)
      : null,
    reopenUntil: reopenUntil(ticket)?.toISOString() ?? null,
  };
}
