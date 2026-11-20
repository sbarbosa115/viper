import type { FastifyInstance } from 'fastify';
import type { Database } from '../../shared/infrastructure/db/database.js';
import { ListCustomers, MarkBusinessInternal } from './application/customers.js';
import { GetDashboard } from './application/get-dashboard.js';
import type { ReportingDeps } from './application/ports.js';
import { reportingRoutes } from './http/reporting.routes.js';

export type {
  CreditsSummary,
  CustomerListQuery,
  CustomerListRow,
  LeadQualityFacts,
  ReportingAudit,
  ReportingBilling,
  ReportingDeps,
  ReportingIdentity,
  ReportingLeads,
  ReportingResearch,
  ReportingSources,
  ReportingTools,
} from './application/ports.js';
export type { BusinessFact } from './domain/customers.js';
export type { RunFact, RunStatus, ToolSpend } from './domain/metrics.js';
export type { TimeWindow } from './domain/period.js';

/** The HTTP module's shape (matches app.ts AppModule). */
export interface ReportingHttpModule {
  readonly name: 'reporting';
  register(app: FastifyInstance): void;
}

export interface Reporting {
  module: ReportingHttpModule;
  getDashboard: GetDashboard;
  listCustomers: ListCustomers;
  markBusinessInternal: MarkBusinessInternal;
}

/**
 * reporting: the read-only Staff dashboard and customer list (FR-30, FR-31). It reads other
 * contexts only through the ports in `deps` (their public queries, wired in composition.ts);
 * nothing depends on reporting.
 */
export function createReporting(deps: ReportingDeps): Reporting {
  const getDashboard = new GetDashboard(deps);
  const listCustomers = new ListCustomers(deps);
  const markBusinessInternal = new MarkBusinessInternal(deps);
  return {
    getDashboard,
    listCustomers,
    markBusinessInternal,
    module: {
      name: 'reporting',
      register: (app) =>
        reportingRoutes(app, { getDashboard, listCustomers, markBusinessInternal }),
    },
  };
}

/**
 * Demo data (PRD section 8a), called by scripts/seed.ts in dependency order. Never in production.
 * Creates nothing: reporting reads other modules.
 */
export function seed(_deps: { db: Database }): Promise<void> {
  return Promise.resolve();
}
