import {
  RUN_PICKER_DAYS,
  RUN_PICKER_LIMIT,
  TICKETS_PAGE_SIZE,
  type RunRef,
  type TicketDetail,
  type TicketListFilter,
  type TicketSummary,
} from '@app/contracts/support';
import type { Actor } from '../../../../shared/domain/actor.js';
import { visibleOrNotFound, viewerFromActor, type TicketListItem } from '../../domain/index.js';
import type { CustomerSupportDeps } from './deps.js';
import { loadNames, toDetail, toSummary } from './mapping.js';

export interface TicketListResult {
  items: TicketSummary[];
  counts: { open: number; closed: number };
  showFrom: boolean;
  nextCursor: string | null;
}

const DAY_MS = 24 * 3600 * 1000;

/** The oldest start the run picker and `runId` accept. */
export function runWindowStart(now: Date): Date {
  return new Date(now.getTime() - RUN_PICKER_DAYS * DAY_MS);
}

/** FR-1: the viewer's visible Tickets, counts, and whether to show the From column (Owner). */
export class ListTickets {
  constructor(private readonly deps: CustomerSupportDeps) {}

  async execute(
    actor: Actor,
    query: { status: TicketListFilter; cursor?: string | undefined; limit?: number | undefined },
  ): Promise<TicketListResult> {
    const viewer = viewerFromActor(actor);
    const page = await this.deps.store.read.listForCustomer({
      viewer,
      filter: query.status,
      cursor: query.cursor ?? null,
      limit: query.limit ?? TICKETS_PAGE_SIZE,
    });
    const names = await loadNames(this.deps, [
      ...page.items.map((i) => i.ticket.openedByMemberId),
      ...page.items.map((i) => i.lastReply?.authorMemberId ?? null),
    ]);
    const runs = await this.runsOf(page.items);
    return {
      items: page.items.map((i) =>
        toSummary(
          i.ticket,
          i.lastReply,
          names,
          i.ticket.runId ? (runs.get(i.ticket.runId) ?? null) : null,
        ),
      ),
      counts: page.counts,
      showFrom: viewer.isOwner,
      nextCursor: page.nextCursor,
    };
  }

  /** The distinct runs of one page (at most 25), looked up once each. */
  private async runsOf(items: readonly TicketListItem[]) {
    const ids = [...new Set(items.flatMap((i) => (i.ticket.runId ? [i.ticket.runId] : [])))];
    const found = await Promise.all(ids.map((id) => this.deps.research.runForSupport(id)));
    return new Map(found.flatMap((r) => (r ? [[r.id, r] as const] : [])));
  }
}

/** FR-4: one Ticket as the customer sees it; 404 when not visible. */
export class GetTicket {
  constructor(private readonly deps: CustomerSupportDeps) {}

  async execute(actor: Actor, number: number): Promise<TicketDetail> {
    const ticket = visibleOrNotFound(
      viewerFromActor(actor),
      await this.deps.store.read.findByNumber(number),
    );
    return toDetail(this.deps, actor, ticket);
  }
}

/** FR-2: the run picker, the Business's runs of the last 90 days, newest first. */
export class ListSupportRuns {
  constructor(private readonly deps: CustomerSupportDeps) {}

  async execute(actor: Actor): Promise<{ items: RunRef[] }> {
    const items = await this.deps.research.recentRunsForBusiness(
      actor.businessId,
      runWindowStart(this.deps.clock.now()),
      RUN_PICKER_LIMIT,
    );
    return { items };
  }
}
