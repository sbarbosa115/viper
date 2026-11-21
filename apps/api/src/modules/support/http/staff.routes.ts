import { routePath } from '@app/contracts/common';
import {
  addInternalNote,
  assignTicket,
  getStaffTicket,
  getWaitingCount,
  listStaffTickets,
  listSupportStaff,
  setTicketStatus,
  staffReplyToTicket,
  takeTicket,
} from '@app/contracts/support';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Actor } from '../../../shared/domain/actor.js';
import { UnauthenticatedError } from '../../../shared/domain/errors.js';
import type { StaffSupport } from '../application/staff/index.js';

function actorOf(req: FastifyRequest): Actor {
  if (!req.actor) throw new UnauthenticatedError('Sign in required');
  return req.actor;
}

/**
 * The Support desk's Staff endpoints (prd-support section 7). Staff checks (403) live in the use
 * cases; Acting as is ignored. Returns the registrar `modules/support/index.ts` calls with the app.
 */
export function staffSupportRoutes(uc: StaffSupport): (app: FastifyInstance) => void {
  return (app) => {
    const api = app.withTypeProvider<ZodTypeProvider>();
    const auth = { preHandler: app.authenticate };
    const tags = ['support-staff'];

    api.get(
      routePath(listStaffTickets),
      {
        ...auth,
        schema: {
          tags,
          querystring: listStaffTickets.query,
          response: { 200: listStaffTickets.response },
        },
      },
      (req) => uc.listTickets(actorOf(req), req.query),
    );

    api.get(
      routePath(getWaitingCount),
      { ...auth, schema: { tags, response: { 200: getWaitingCount.response } } },
      (req) => uc.waitingCount(actorOf(req)),
    );

    api.get(
      routePath(listSupportStaff),
      { ...auth, schema: { tags, response: { 200: listSupportStaff.response } } },
      (req) => uc.listStaff(actorOf(req)),
    );

    api.get(
      routePath(getStaffTicket),
      {
        ...auth,
        schema: { tags, params: getStaffTicket.params, response: { 200: getStaffTicket.response } },
      },
      (req) => uc.getTicket(actorOf(req), req.params.number),
    );

    api.post(
      routePath(takeTicket),
      {
        ...auth,
        schema: {
          tags,
          params: takeTicket.params,
          body: takeTicket.body,
          response: { 200: takeTicket.response },
        },
      },
      (req) => uc.take(actorOf(req), req.params.number, req.body.version),
    );

    api.post(
      routePath(assignTicket),
      {
        ...auth,
        schema: {
          tags,
          params: assignTicket.params,
          body: assignTicket.body,
          response: { 200: assignTicket.response },
        },
      },
      (req) => uc.assign(actorOf(req), req.params.number, req.body),
    );

    api.post(
      routePath(setTicketStatus),
      {
        ...auth,
        schema: {
          tags,
          params: setTicketStatus.params,
          body: setTicketStatus.body,
          response: { 200: setTicketStatus.response },
        },
      },
      (req) => uc.setStatus(actorOf(req), req.params.number, req.body),
    );

    api.post(
      routePath(staffReplyToTicket),
      {
        ...auth,
        schema: {
          tags,
          params: staffReplyToTicket.params,
          body: staffReplyToTicket.body,
          response: { 201: staffReplyToTicket.response },
        },
      },
      async (req, reply) =>
        reply.status(201).send(await uc.reply(actorOf(req), req.params.number, req.body)),
    );

    api.post(
      routePath(addInternalNote),
      {
        ...auth,
        schema: {
          tags,
          params: addInternalNote.params,
          body: addInternalNote.body,
          response: { 201: addInternalNote.response },
        },
      },
      async (req, reply) =>
        reply.status(201).send(await uc.addNote(actorOf(req), req.params.number, req.body.note)),
    );
  };
}
