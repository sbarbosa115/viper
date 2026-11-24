import type { Actor } from '../domain/actor.js';

export interface AnalyticsEvent {
  readonly name: string;
  /** businessId is null for Staff-only events that belong to no Business (e.g. finance). */
  readonly actor?: { memberId: Actor['memberId']; businessId: Actor['businessId'] | null };
  readonly properties?: Record<string, unknown>;
}

export interface AnalyticsTracker {
  track(event: AnalyticsEvent): Promise<void>;
}
