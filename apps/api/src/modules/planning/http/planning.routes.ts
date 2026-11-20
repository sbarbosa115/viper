import { routePath } from '@app/contracts/common';
import { createPlan, getPlan, listPlans, searchPlaces, updatePlan } from '@app/contracts/planning';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Actor } from '../../../shared/domain/actor.js';
import { UnauthenticatedError } from '../../../shared/domain/errors.js';
import type { PlanningApplication } from '../application/planning.js';

function actorOf(req: FastifyRequest): Actor {
  if (!req.actor) throw new UnauthenticatedError('Sign in required');
  return req.actor;
}

/** Planning endpoints (PRD section 7, FR-16, FR-17), registered under /api. */
export function planningRoutes(app: FastifyInstance, planning: PlanningApplication): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };
  const tags = ['planning'];

  api.post(
    routePath(createPlan),
    { ...auth, schema: { tags, body: createPlan.body, response: { 201: createPlan.response } } },
    async (req, reply) => {
      const actor = actorOf(req);
      const { plan, warnings } = await planning.createPlan.execute(actor, req.body.goal);
      return reply.status(201).send(await planning.queries.getPlan(actor, plan.id, warnings));
    },
  );

  api.get(
    routePath(listPlans),
    {
      ...auth,
      schema: { tags, querystring: listPlans.query, response: { 200: listPlans.response } },
    },
    (req) => planning.queries.listPlans(actorOf(req), req.query),
  );

  api.get(
    routePath(getPlan),
    { ...auth, schema: { tags, params: getPlan.params, response: { 200: getPlan.response } } },
    (req) => planning.queries.getPlan(actorOf(req), req.params.id),
  );

  api.patch(
    routePath(updatePlan),
    {
      ...auth,
      schema: {
        tags,
        params: updatePlan.params,
        body: updatePlan.body,
        response: { 200: updatePlan.response },
      },
    },
    async (req) => {
      const actor = actorOf(req);
      const plan = await planning.updatePlan.execute(actor, req.params.id, req.body);
      return planning.queries.getPlan(actor, plan.id);
    },
  );

  api.get(
    routePath(searchPlaces),
    {
      ...auth,
      schema: { tags, querystring: searchPlaces.query, response: { 200: searchPlaces.response } },
    },
    (req) => planning.queries.searchPlaces(actorOf(req), req.query.q),
  );
}
