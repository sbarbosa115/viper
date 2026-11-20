import type { AnalyticsEvent, AnalyticsTracker } from '../../application/analytics-tracker.js';

// The production tracker is platform's createDbAnalyticsTracker; this file keeps the test double.

/** Test double: records events so application tests can assert them. */
export class RecordingAnalyticsTracker implements AnalyticsTracker {
  readonly events: AnalyticsEvent[] = [];
  track(event: AnalyticsEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}
