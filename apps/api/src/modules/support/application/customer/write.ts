import type { CreateTicketBody, TicketDetail } from '@app/contracts/support';
import type { Actor } from '../../../../shared/domain/actor.js';
import {
  assertNotActingAs,
  assertUnderOpenLimit,
  assertUnderRateLimit,
  customerClose,
  customerReply,
  openTicket,
  outboxEvents,
  supportErrors,
  supportLimits,
  visibleOrNotFound,
  viewerFromActor,
  windowStart,
  type SupportTx,
  type Ticket,
  type TicketChange,
} from '../../domain/index.js';
import { customerChangeEvents } from './analytics.js';
import type { CustomerSupportDeps } from './deps.js';
import { toDetail } from './mapping.js';
import { runWindowStart } from './read.js';

export interface CreateTicketResult {
  ticket: TicketDetail;
  /** False for the 60-second duplicate: the existing Ticket, answered with 200. */
  created: boolean;
}

async function publish(tx: SupportTx, change: TicketChange): Promise<void> {
  for (const e of outboxEvents(change.ticket, change.events)) {
    await tx.events.publish(e.type, e.payload);
  }
}

/** FR-2: open a Ticket. */
export class CreateTicket {
  constructor(private readonly deps: CustomerSupportDeps) {}

  async execute(actor: Actor, body: CreateTicketBody): Promise<CreateTicketResult> {
    assertNotActingAs(actor);
    const { store, clock } = this.deps;
    const now = clock.now();
    const subject = body.subject.trim();
    const message = body.message.trim();

    const duplicate = await store.read.findDuplicate({
      memberId: actor.memberId,
      subject,
      message,
      since: windowStart(now, supportLimits.duplicateWindowMs),
    });
    if (duplicate) return { ticket: await toDetail(this.deps, actor, duplicate), created: false };

    await this.assertRunIsTheirs(actor, body.runId, now);
    assertUnderRateLimit(
      await store.read.ticketsOpenedBy(
        actor.memberId,
        windowStart(now, supportLimits.ticketsPerMember.windowMs),
      ),
      supportLimits.ticketsPerMember,
      now,
    );
    const balance = await this.deps.billing.balanceFor(actor.businessId);

    const ticket = await store.run(async (tx) => {
      assertUnderOpenLimit(await tx.tickets.lockOpenTicketsOfBusiness(actor.businessId));
      const opened = openTicket(
        {
          id: this.deps.ids.next(),
          businessId: actor.businessId,
          openedByMemberId: actor.memberId,
          category: body.category,
          subject,
          message,
          runId: body.runId ?? null,
          source: body.source,
          pagePath: body.pagePath ?? null,
          balanceAtOpen: balance,
        },
        { now, ids: this.deps.ids },
      );
      const created = await tx.tickets.create(opened);
      for (const e of outboxEvents(created, opened.events)) {
        await tx.events.publish(e.type, e.payload);
      }
      return created;
    });

    await this.deps.analytics.track({
      name: 'ticket_opened',
      actor: { memberId: actor.memberId, businessId: actor.businessId },
      properties: {
        ticket_number: ticket.number,
        business_id: ticket.businessId,
        category: ticket.category,
        has_run: ticket.runId !== null,
        source: ticket.source,
      },
    });
    return { ticket: await toDetail(this.deps, actor, ticket), created: true };
  }

  /** 404 UNKNOWN_RUN unless the run is the Business's and started in the last 90 days. */
  private async assertRunIsTheirs(actor: Actor, runId: string | undefined, now: Date) {
    if (!runId) return;
    const run = await this.deps.research.runForSupport(runId);
    if (run?.businessId !== actor.businessId || new Date(run.startedAt) < runWindowStart(now)) {
      throw supportErrors.unknownRun();
    }
  }
}

/** The shared shape of reply and close: lock, check visibility, apply, save, publish, track. */
async function changeOwnTicket(
  deps: CustomerSupportDeps,
  actor: Actor,
  number: number,
  command: (tx: SupportTx, ticket: Ticket, now: Date) => Promise<TicketChange>,
): Promise<TicketDetail> {
  assertNotActingAs(actor);
  const now = deps.clock.now();
  const { before, change, messages } = await deps.store.run(async (tx) => {
    const found = visibleOrNotFound(
      viewerFromActor(actor),
      await tx.tickets.findByNumber(number, { forUpdate: true }),
    );
    const result = await command(tx, found, now);
    await tx.tickets.saveChange(result);
    await publish(tx, result);
    return { before: found, change: result, messages: await tx.tickets.messages(found.id) };
  });
  for (const event of customerChangeEvents({ actor, before, change, messages, now })) {
    await deps.analytics.track(event);
  }
  return toDetail(deps, actor, change.ticket);
}

/** FR-4: a customer reply; reopens a closed Ticket within 30 days. */
export class ReplyToTicket {
  constructor(private readonly deps: CustomerSupportDeps) {}

  execute(actor: Actor, number: number, input: { message: string }): Promise<TicketDetail> {
    return changeOwnTicket(this.deps, actor, number, async (tx, ticket, now) => {
      assertUnderRateLimit(
        await tx.tickets.customerRepliesBy(
          actor.memberId,
          windowStart(now, supportLimits.repliesPerMember.windowMs),
        ),
        supportLimits.repliesPerMember,
        now,
      );
      return customerReply(
        ticket,
        { memberId: actor.memberId, text: input.message },
        { now, ids: this.deps.ids },
      );
    });
  }
}

/** FR-5: the customer closes a Ticket. No email. */
export class CloseTicket {
  constructor(private readonly deps: CustomerSupportDeps) {}

  execute(actor: Actor, number: number): Promise<TicketDetail> {
    return changeOwnTicket(this.deps, actor, number, (_tx, ticket, now) =>
      Promise.resolve(
        customerClose(ticket, { memberId: actor.memberId }, { now, ids: this.deps.ids }),
      ),
    );
  }
}
