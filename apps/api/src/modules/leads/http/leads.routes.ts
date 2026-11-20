import { routePath } from '@app/contracts/common';
import { exportLeadsCsv, getLead, listLeads, setLeadFeedback } from '@app/contracts/leads';
import { stringify } from 'csv-stringify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { pipeline, Readable } from 'node:stream';
import type { Actor } from '../../../shared/domain/actor.js';
import { UnauthenticatedError } from '../../../shared/domain/errors.js';
import type { LeadsApplication } from '../application/leads.js';

function actorOf(req: FastifyRequest): Actor {
  if (!req.actor) throw new UnauthenticatedError('Sign in required');
  return req.actor;
}

/** Leads endpoints (PRD section 7, FR-26 to FR-28), registered under /api. */
export function leadsRoutes(app: FastifyInstance, leads: LeadsApplication): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };
  const tags = ['leads'];

  api.get(
    routePath(listLeads),
    {
      ...auth,
      schema: {
        tags,
        params: listLeads.params,
        querystring: listLeads.query,
        response: { 200: listLeads.response },
      },
    },
    (req) => leads.queries.listLeads(actorOf(req), req.params.id, req.query),
  );

  api.get(
    routePath(getLead),
    { ...auth, schema: { tags, params: getLead.params, response: { 200: getLead.response } } },
    (req) => leads.queries.getLead(actorOf(req), req.params.id),
  );

  api.put(
    routePath(setLeadFeedback),
    {
      ...auth,
      schema: {
        tags,
        params: setLeadFeedback.params,
        body: setLeadFeedback.body,
        response: { 200: setLeadFeedback.response },
      },
    },
    (req) => leads.setFeedback.execute(actorOf(req), req.params.id, req.body),
  );

  api.get(
    routePath(exportLeadsCsv),
    { ...auth, schema: { tags, params: exportLeadsCsv.params, querystring: exportLeadsCsv.query } },
    async (req, reply) => {
      const { fileName, rows } = await leads.queries.exportLeads(
        actorOf(req),
        req.params.id,
        req.query,
      );
      // pipeline destroys the response stream if reading a page fails mid-export.
      const csv = pipeline(
        Readable.from(rows),
        stringify({ record_delimiter: 'windows' }),
        (err) => {
          if (err) req.log.error({ err }, 'CSV export failed');
        },
      );
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${fileName}"`)
        .header('Cache-Control', 'no-store')
        .send(csv);
    },
  );
}
