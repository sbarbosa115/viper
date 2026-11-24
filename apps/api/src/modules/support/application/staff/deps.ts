import type { Clock } from '../../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../../shared/domain/id-generator.js';
import type { SupportStore } from '../../domain/index.js';
import type {
  AnalyticsTracker,
  BillingForSupport,
  IdentityForSupport,
  ResearchForSupport,
  SupportAudit,
} from '../../ports.js';

/** What the Staff use cases need (the orchestrator wires the real adapters; tests use fakes). */
export interface StaffSupportDeps {
  store: SupportStore;
  identity: IdentityForSupport;
  research: ResearchForSupport;
  billing: BillingForSupport;
  audit: SupportAudit;
  analytics: AnalyticsTracker;
  clock: Clock;
  ids: IdGenerator;
}
