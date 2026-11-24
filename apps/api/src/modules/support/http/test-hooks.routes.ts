import { routePath } from '@app/contracts/common';
import { closeTicketAgo, fillOpenTickets } from '@app/contracts/support';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Clock } from '../../../shared/domain/clock.js';
import { ConflictError, NotFoundError } from '../../../shared/domain/errors.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import { openTicket, supportErrors, type SupportStore } from '../domain/index.js';
import type { IdentityForSupport } from '../ports.js';

const DAY_MS = 24 * 3600 * 1000;

export interface SupportTestHooksDeps {
  /** The config's NODE_ENV: the hooks exist only when it is `test`. */
  nodeEnv: string;
  store: SupportStore;
  identity: Pick<IdentityForSupport, 'businessNames'>;
  /** The Business's Owner (the opener of filler Tickets); null when it has no Members. */
  ownerOf(businessId: string): Promise<string | null>;
  clock: Clock;
  ids: IdGenerator;
}

/** AJ-4 and AJ-6 test hooks (prd-support section 7). Registers nothing unless NODE_ENV=test. */
export function supportTestRoutes(deps: SupportTestHooksDeps): (app: FastifyInstance) => void {
  return (app) => {
    if (deps.nodeEnv !== 'test') return;
    const api = app.withTypeProvider<ZodTypeProvider>();
    const tags = ['test'];

    api.post(
      routePath(closeTicketAgo),
      {
        schema: {
          tags,
          hide: true,
          body: closeTicketAgo.body,
          response: { 200: closeTicketAgo.response },
        },
      },
      async (req) => {
        const { number, days } = req.body;
        return deps.store.run(async (tx) => {
          const ticket = await tx.tickets.findByNumber(number, { forUpdate: true });
          if (!ticket) throw supportErrors.ticketNotFound();
          if (ticket.status !== 'closed') throw new ConflictError('The ticket is not closed');
          const closedAt = new Date(deps.clock.now().getTime() - days * DAY_MS);
          await tx.tickets.saveChange({
            ticket: { ...ticket, closedAt, version: ticket.version + 1 },
            expectedVersion: ticket.version,
            changed: true,
            messages: [],
            events: [],
            facts: [],
          });
          return { number, closedAt: closedAt.toISOString() };
        });
      },
    );

    api.post(
      routePath(fillOpenTickets),
      {
        schema: {
          tags,
          hide: true,
          body: fillOpenTickets.body,
          response: { 200: fillOpenTickets.response },
        },
      },
      async (req) => {
        const { businessId, count } = req.body;
        const [business] = await deps.identity.businessNames([businessId]);
        const owner = business ? await deps.ownerOf(businessId) : null;
        if (!business || !owner) throw new NotFoundError('Business not found');
        return deps.store.run(async (tx) => {
          const open = await tx.tickets.lockOpenTicketsOfBusiness(businessId);
          const numbers: number[] = [];
          for (let n = open; n < count; n += 1) {
            const opened = openTicket(
              {
                id: deps.ids.next(),
                businessId,
                openedByMemberId: owner,
                category: 'other',
                subject: `Filler ticket ${String(n + 1)}`,
                message: 'Filler ticket created by the test hook.',
                runId: null,
                source: 'help',
                pagePath: null,
                balanceAtOpen: null,
              },
              { now: deps.clock.now(), ids: deps.ids },
            );
            numbers.push((await tx.tickets.create(opened)).number);
          }
          return { numbers };
        });
      },
    );
  };
}
