import type { AnalyticsEvent, AnalyticsTracker } from '../../application/analytics-tracker.js';

/**
 * Stub: the `analytics_events` table and the insert arrive with the platform module (WP-2).
 * Until then events are dropped, so use cases can already depend on the port.
 */
export class DbAnalyticsTracker implements AnalyticsTracker {
  track(_event: AnalyticsEvent): Promise<void> {
    return Promise.resolve();
  }
}

/** Test double: records events so application tests can assert them. */
export class RecordingAnalyticsTracker implements AnalyticsTracker {
  readonly events: AnalyticsEvent[] = [];
  track(event: AnalyticsEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}
