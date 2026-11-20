import { routePath } from '@app/contracts/common';
import { getDashboard, listCustomers, updateCustomer } from '@app/contracts/reporting';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ListCustomers, MarkBusinessInternal } from '../application/customers.js';
import type { GetDashboard } from '../application/get-dashboard.js';

export interface ReportingRouteDeps {
  getDashboard: GetDashboard;
  listCustomers: ListCustomers;
  markBusinessInternal: MarkBusinessInternal;
}

/** FR-30, FR-31 (PRD section 7, Reporting). Staff checks live in the use cases. */
export function reportingRoutes(app: FastifyInstance, deps: ReportingRouteDeps): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    routePath(getDashboard),
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['reporting'],
        querystring: getDashboard.query,
        response: { 200: getDashboard.response },
      },
    },
    (req) => deps.getDashboard.execute({ actor: req.actor, period: req.query.period }),
  );

  api.get(
    routePath(listCustomers),
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['reporting'],
        querystring: listCustomers.query,
        response: { 200: listCustomers.response },
      },
    },
    (req) =>
      deps.listCustomers.execute({
        actor: req.actor,
        sort: req.query.sort,
        limit: req.query.limit,
        ...(req.query.q ? { q: req.query.q } : {}),
        ...(req.query.cursor ? { cursor: req.query.cursor } : {}),
      }),
  );

  api.patch(
    routePath(updateCustomer),
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['reporting'],
        params: updateCustomer.params,
        body: updateCustomer.body,
        response: { 200: updateCustomer.response },
      },
    },
    (req) =>
      deps.markBusinessInternal.execute({
        actor: req.actor,
        businessId: req.params.id,
        internal: req.body.internal,
      }),
  );
}
