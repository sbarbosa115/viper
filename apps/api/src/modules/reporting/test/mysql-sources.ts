import type { ReportingSources } from '../application/ports.js';

/**
 * The real modules' public queries, as composition.ts hands them to reporting. The int tests
 * build the module objects from each module's index.ts and pass them in, so this file stays
 * inside reporting's boundaries.
 */
export interface ModuleQueries {
  identity: ReportingSources['identity'];
  billing: ReportingSources['billing'];
  research: ReportingSources['research'];
  leads: ReportingSources['leads'];
  tools: ReportingSources['tools'];
}

export function mysqlSources(modules: ModuleQueries): ReportingSources {
  return {
    identity: {
      allBusinesses: () => modules.identity.allBusinesses(),
      listBusinesses: (q) => modules.identity.listBusinesses(q),
      getBusiness: (id) => modules.identity.getBusiness(id),
      getOwnerContact: (id) => modules.identity.getOwnerContact(id),
      setBusinessInternal: (id, internal, by) =>
        modules.identity.setBusinessInternal(id, internal, by),
    },
    billing: {
      creditsSummary: (f) => modules.billing.creditsSummary(f),
      availableByBusiness: (ids) => modules.billing.availableByBusiness(ids),
      payingBusinessIds: (ids, options) => modules.billing.payingBusinessIds(ids, options),
    },
    research: {
      runFacts: (window) => modules.research.runFacts(window),
      runCounts: (ids) => modules.research.runCounts(ids),
    },
    leads: {
      leadQuality: (window) => modules.leads.leadQuality(window),
      deliveredCounts: (ids) => modules.leads.deliveredCounts(ids),
    },
    tools: { spendByTool: (window) => modules.tools.spendByTool(window) },
  };
}
