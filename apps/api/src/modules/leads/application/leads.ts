import type { AnalyticsTracker } from '../../../shared/application/analytics-tracker.js';
import type { Clock } from '../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import { LeadQueries } from './lead-queries.js';
import type { LeadsUnitOfWork, PlanLookup, RunCosts } from './ports.js';
import { createProspectStoreUseCases, type ProspectStore } from './prospect-store.js';
import { SetLeadFeedback } from './set-feedback.js';

export interface LeadsApplicationDeps {
  uow: LeadsUnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  analytics: AnalyticsTracker;
  plans: PlanLookup;
  runCosts: RunCosts;
}

export interface LeadsApplication {
  prospects: ProspectStore;
  queries: LeadQueries;
  setFeedback: SetLeadFeedback;
}

export function createLeadsApplication(deps: LeadsApplicationDeps): LeadsApplication {
  return {
    prospects: createProspectStoreUseCases(deps),
    queries: new LeadQueries(deps),
    setFeedback: new SetLeadFeedback(deps),
  };
}
