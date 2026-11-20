import type { Actor } from '../domain/actor.js';

export interface AnalyticsEvent {
  readonly name: string;
  readonly actor?: Pick<Actor, 'memberId' | 'businessId'>;
  readonly properties?: Record<string, unknown>;
}

export interface AnalyticsTracker {
  track(event: AnalyticsEvent): Promise<void>;
}
