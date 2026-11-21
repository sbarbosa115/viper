import { routePath } from '@app/contracts/common';
import {
  closeTicket,
  createTicket,
  getTicket,
  listSupportRuns,
  listTickets,
  replyToTicket,
} from '@app/contracts/support';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Actor } from '../../../shared/domain/actor.js';
import { CodedError, UnauthenticatedError } from '../../../shared/domain/errors.js';
import type { CustomerSupportUseCases } from '../application/customer/index.js';

/** The signed-in actor; `app.authenticate` has already answered 401 otherwise. */
function actorOf(req: FastifyRequest): Actor {
  if (!req.actor) throw new UnauthenticatedError('Sign in required');
  return req.actor;
}

/** Sets `Retry-After` on a 429 from the domain's rate limits, then lets the error handler answer. */
async function withRetryAfter<T>(reply: FastifyReply, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CodedError && error.code === 'TOO_MANY_REQUESTS') {
      const seconds = error.details?.retryAfterSeconds;
      if (typeof seconds === 'number') void reply.header('Retry-After', String(seconds));
    }
    throw error;
  }
}

/**
 * prd-support section 7, customer endpoints (auth `session`). Visibility (404), Acting as (403)
 * and the limits live in the use cases.
 */
export function customerSupportRoutes(app: FastifyInstance, uc: CustomerSupportUseCases): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };
  const tags = ['support'];

  api.get(
    routePath(listTickets),
    {
      ...auth,
      schema: { tags, querystring: listTickets.query, response: { 200: listTickets.response } },
    },
    (req) => uc.listTickets.execute(actorOf(req), req.query),
  );

  api.post(
    routePath(createTicket),
    {
      ...auth,
      schema: {
        tags,
        body: createTicket.body,
        response: { 200: createTicket.response, 201: createTicket.response },
      },
    },
    async (req, reply) => {
      const { ticket, created } = await withRetryAfter(reply, () =>
        uc.createTicket.execute(actorOf(req), req.body),
      );
      return reply.status(created ? 201 : 200).send(ticket);
    },
  );

  api.get(
    routePath(getTicket),
    {
      ...auth,
      schema: { tags, params: getTicket.params, response: { 200: getTicket.response } },
    },
    (req) => uc.getTicket.execute(actorOf(req), req.params.number),
  );

  api.post(
    routePath(replyToTicket),
    {
      ...auth,
      schema: {
        tags,
        params: replyToTicket.params,
        body: replyToTicket.body,
        response: { 201: replyToTicket.response },
      },
    },
    async (req, reply) =>
      reply
        .status(201)
        .send(
          await withRetryAfter(reply, () =>
            uc.replyToTicket.execute(actorOf(req), req.params.number, req.body),
          ),
        ),
  );

  api.post(
    routePath(closeTicket),
    {
      ...auth,
      schema: {
        tags,
        params: closeTicket.params,
        body: closeTicket.body,
        response: { 200: closeTicket.response },
      },
    },
    (req) => uc.closeTicket.execute(actorOf(req), req.params.number),
  );

  api.get(
    routePath(listSupportRuns),
    { ...auth, schema: { tags, response: { 200: listSupportRuns.response } } },
    (req) => uc.listSupportRuns.execute(actorOf(req)),
  );
}
