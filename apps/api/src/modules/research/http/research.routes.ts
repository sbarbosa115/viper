import { noContent, routePath } from '@app/contracts/common';
import {
  cancelRun,
  getFlow,
  getQueueHealth,
  getRun,
  getStaffRun,
  listFlows,
  listPlanRuns,
  listStaffRuns,
  resumeRun,
  resumeStaffRun,
  startRun,
  stepKey,
  updateFlow,
} from '@app/contracts/research';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Actor } from '../../../shared/domain/actor.js';
import { UnauthenticatedError } from '../../../shared/domain/errors.js';
import type { FlowUseCases } from '../application/flows.js';
import type { StopHook } from '../application/ports.js';
import type { RunUseCases } from '../application/runs.js';

function actorOf(req: FastifyRequest): Actor {
  if (!req.actor) throw new UnauthenticatedError('Sign in required');
  return req.actor;
}

export interface ResearchRouteDeps {
  runs: RunUseCases;
  flows: FlowUseCases;
  /** Present only with ENABLE_TEST_HOOKS (never in production): POST /api/test/research/stop-after. */
  stopHook?: StopHook;
}

const stopAfterBody = z.object({ stepKey, items: z.int().min(0).max(10_000) });

/** Research endpoints (PRD section 7: runs, Staff runs monitor, queue health, Research flows). */
export function researchRoutes(app: FastifyInstance, deps: ResearchRouteDeps): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };
  const tags = ['research'];
  const { runs, flows } = deps;

  api.post(
    routePath(startRun),
    { ...auth, schema: { tags, params: startRun.params, response: { 201: startRun.response } } },
    async (req, reply) => reply.status(201).send(await runs.start(actorOf(req), req.params.id)),
  );

  api.get(
    routePath(listPlanRuns),
    {
      ...auth,
      schema: {
        tags,
        params: listPlanRuns.params,
        querystring: listPlanRuns.query,
        response: { 200: listPlanRuns.response },
      },
    },
    (req) => runs.listForPlan(actorOf(req), req.params.id, req.query),
  );

  api.get(
    routePath(getRun),
    { ...auth, schema: { tags, params: getRun.params, response: { 200: getRun.response } } },
    (req) => runs.get(actorOf(req), req.params.id),
  );

  api.post(
    routePath(cancelRun),
    { ...auth, schema: { tags, params: cancelRun.params, response: { 202: cancelRun.response } } },
    async (req, reply) => reply.status(202).send(await runs.cancel(actorOf(req), req.params.id)),
  );

  api.post(
    routePath(resumeRun),
    { ...auth, schema: { tags, params: resumeRun.params, response: { 202: resumeRun.response } } },
    async (req, reply) => reply.status(202).send(await runs.resume(actorOf(req), req.params.id)),
  );

  // Staff -----------------------------------------------------------------------------------------

  api.get(
    routePath(listStaffRuns),
    {
      ...auth,
      schema: { tags, querystring: listStaffRuns.query, response: { 200: listStaffRuns.response } },
    },
    (req) => runs.listForStaff(actorOf(req), req.query),
  );

  api.get(
    routePath(getStaffRun),
    {
      ...auth,
      schema: { tags, params: getStaffRun.params, response: { 200: getStaffRun.response } },
    },
    (req) => runs.getForStaff(actorOf(req), req.params.id),
  );

  api.post(
    routePath(resumeStaffRun),
    {
      ...auth,
      config: { audit: false },
      schema: { tags, params: resumeStaffRun.params, response: { 202: resumeStaffRun.response } },
    },
    async (req, reply) =>
      reply.status(202).send(await runs.resumeAsStaff(actorOf(req), req.params.id)),
  );

  api.get(
    routePath(getQueueHealth),
    { ...auth, schema: { tags, response: { 200: getQueueHealth.response } } },
    (req) => runs.queueHealth(actorOf(req)),
  );

  api.get(
    routePath(listFlows),
    { ...auth, schema: { tags, response: { 200: listFlows.response } } },
    (req) => flows.list(actorOf(req)),
  );

  api.get(
    routePath(getFlow),
    { ...auth, schema: { tags, params: getFlow.params, response: { 200: getFlow.response } } },
    (req) => flows.get(actorOf(req), req.params.key),
  );

  api.put(
    routePath(updateFlow),
    {
      ...auth,
      config: { audit: false },
      schema: {
        tags,
        params: updateFlow.params,
        body: updateFlow.body,
        response: { 201: updateFlow.response },
      },
    },
    async (req, reply) =>
      reply.status(201).send(await flows.update(actorOf(req), req.params.key, req.body)),
  );

  const { stopHook } = deps;
  if (stopHook) {
    api.post(
      '/test/research/stop-after',
      { schema: { tags: ['test'], body: stopAfterBody, response: { 204: noContent } } },
      async (req, reply) => {
        await stopHook.set(req.body);
        return reply.status(204).send(null);
      },
    );
  }
}
