import type { Actor } from '../../../shared/domain/actor.js';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { FixtureGeocoder } from '../../../shared/infrastructure/geo/fixture-geocoder.js';
import { ScriptedLlmClient } from '../../../shared/infrastructure/llm/scripted-llm-client.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import { createInMemoryProfile } from '../../profile/index.js';
import type { LlmUsage, PlanDrafter } from '../application/ports.js';
import { createInMemoryAssistant } from '../index.js';

export const BUSINESS = '00000000-0000-7000-8000-00000000b001';
export const OTHER_BUSINESS = '00000000-0000-7000-8000-00000000b002';
export const OWNER_ID = '00000000-0000-7000-8000-00000000c001';
export const PLAN_ID = '00000000-0000-7000-8000-00000000e001';

export function owner(overrides: Partial<Actor> = {}): Actor {
  return {
    memberId: OWNER_ID,
    businessId: BUSINESS,
    roles: ['owner'],
    emailVerified: false,
    ...overrides,
  };
}

/** planning's role: records the goals and returns a fixed Plan id (or fails as told). */
export class FakePlanDrafter implements PlanDrafter {
  readonly goals: { actor: Actor; goal: string }[] = [];
  failWith: Error | null = null;
  draftFromGoal(actor: Actor, goal: string): Promise<{ planId: string }> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.goals.push({ actor, goal });
    return Promise.resolve({ planId: PLAN_ID });
  }
}

export const extract = (input: Record<string, unknown>) =>
  ScriptedLlmClient.toolCall('record_profile_updates', input);
export const reply = (text: string, quickReplies: string[] = []) =>
  ScriptedLlmClient.toolCall('write_reply', { text, quickReplies });

/** The assistant on in-memory Conversations and an in-memory profile module. */
export function assistantFixture(options: { llm?: ScriptedLlmClient; limit?: number } = {}) {
  const clock = new FixedClock(new Date('2026-11-19T10:00:00.000Z'));
  const ids = new SequentialIdGenerator();
  const analytics = new RecordingAnalyticsTracker();
  const geocoder = new FixtureGeocoder();
  const profile = createInMemoryProfile({ clock, ids, analytics, geocoder });
  profile.names.names.set(BUSINESS, 'Sweet Supply Co');
  profile.names.names.set(OTHER_BUSINESS, 'Clean Desk Co');
  const llm = options.llm ?? new ScriptedLlmClient();
  const planDrafter = new FakePlanDrafter();
  const usage: LlmUsage[] = [];
  const assistant = createInMemoryAssistant({
    clock,
    ids,
    profile: {
      getProfile: profile.profileQueries.getProfile,
      applyUpdates: profile.profileCommands.applyUpdates,
    },
    llm,
    geocoder,
    planDrafter,
    usage: { onLlmUsage: (u) => void usage.push(u) },
    ...(options.limit !== undefined ? { dailyMessageLimit: options.limit } : {}),
  });
  return { ...assistant, clock, analytics, profile, llm, planDrafter, usage };
}
