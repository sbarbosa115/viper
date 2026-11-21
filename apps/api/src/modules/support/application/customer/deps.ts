import type { Clock } from '../../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../../shared/domain/id-generator.js';
import type { SupportStore } from '../../domain/index.js';
import type {
  AnalyticsTracker,
  BillingForSupport,
  IdentityForSupport,
  ResearchForSupport,
} from '../../ports.js';

/** What the customer use cases need (composition builds them from the real adapters). */
export interface CustomerSupportDeps {
  store: SupportStore;
  identity: Pick<IdentityForSupport, 'memberSummaries'>;
  research: ResearchForSupport;
  billing: BillingForSupport;
  analytics: AnalyticsTracker;
  clock: Clock;
  ids: IdGenerator;
}
