import type {
  AnalyticsEvent,
  AnalyticsTracker,
} from '../../../shared/application/analytics-tracker.js';
import type { Clock } from '../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import type { Database } from '../../../shared/infrastructure/db/database.js';
import { safeEventProperties } from '../domain/event-properties.js';

/**
 * Product events (PRD section 3a) in `analytics_events`. Properties are filtered so no personal
 * data is stored (NFR-5). A failed insert is reported, never thrown: analytics must not break
 * the use case that emits it.
 */
export class DbAnalyticsTracker implements AnalyticsTracker {
  constructor(
    private readonly deps: {
      db: Database;
      clock: Clock;
      ids: IdGenerator;
      onError?: (err: unknown, event: Pick<AnalyticsEvent, 'name'>) => void;
    },
  ) {}

  async track(event: AnalyticsEvent): Promise<void> {
    try {
      await this.deps.db
        .insertInto('analytics_events')
        .values({
          id: this.deps.ids.next(),
          name: event.name,
          business_id: event.actor?.businessId ?? null,
          member_id: event.actor?.memberId ?? null,
          properties: JSON.stringify(safeEventProperties(event.properties)),
          at: this.deps.clock.now(),
        })
        .execute();
    } catch (err) {
      this.deps.onError?.(err, { name: event.name });
    }
  }
}
