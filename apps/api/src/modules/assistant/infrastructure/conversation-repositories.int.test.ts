import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { FixtureGeocoder } from '../../../shared/infrastructure/geo/fixture-geocoder.js';
import { ScriptedLlmClient } from '../../../shared/infrastructure/llm/scripted-llm-client.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { createProfile, InMemoryBusinessNames } from '../../profile/index.js';
import { createAssistant } from '../index.js';
import {
  FakePlanDrafter,
  owner,
  OTHER_BUSINESS,
  BUSINESS,
  PLAN_ID,
} from '../test/assistant-fixture.js';
import { KyselyConversationRepository } from './conversation-repositories.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const clock = new FixedClock(new Date('2026-11-19T10:00:00.000Z'));
const ids = new Uuid7Generator();
const tick = () => clock.set(new Date(clock.now().getTime() + 1000));

beforeEach(async () => {
  await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
  for (const table of ['conversations', 'messages', 'business_profiles', 'products']) {
    await sql.raw(`TRUNCATE TABLE ${table}`).execute(db);
  }
  await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);
});

afterAll(async () => {
  await db.destroy();
});

describe('assistant on MySQL', () => {
  test('one welcome Conversation per Business, even when created twice', async () => {
    const repo = new KyselyConversationRepository(db);
    const a = await repo.createWelcome({
      id: ids.next(),
      businessId: BUSINESS,
      kind: 'welcome',
      createdAt: clock.now(),
    });
    const b = await repo.createWelcome({
      id: ids.next(),
      businessId: BUSINESS,
      kind: 'welcome',
      createdAt: clock.now(),
    });
    expect(b.id).toBe(a.id);
    expect(await repo.findById(a.id)).toEqual(a);
    expect(await repo.findWelcome(OTHER_BUSINESS)).toBeNull();
  });

  test('messages round trip in order, with quick replies and topic; daily count is per Business', async () => {
    const repo = new KyselyConversationRepository(db);
    const mine = await repo.createWelcome({
      id: ids.next(),
      businessId: BUSINESS,
      kind: 'welcome',
      createdAt: clock.now(),
    });
    const theirs = await repo.createWelcome({
      id: ids.next(),
      businessId: OTHER_BUSINESS,
      kind: 'welcome',
      createdAt: clock.now(),
    });
    const q = {
      id: ids.next(),
      conversationId: mine.id,
      role: 'assistant' as const,
      text: 'What do you sell?',
      quickReplies: ['Sugar'],
      topic: 'products' as const,
      createdAt: clock.now(),
    };
    const u = {
      id: ids.next(),
      conversationId: mine.id,
      role: 'user' as const,
      text: 'Sugar',
      quickReplies: [],
      topic: null,
      createdAt: clock.now(),
    };
    await repo.addMessage(u);
    await repo.addMessage(q);
    await repo.addMessage({ ...u, id: ids.next(), conversationId: theirs.id });
    const listed = await repo.listMessages(mine.id);
    expect(listed).toEqual([u, q].sort((a, b) => a.id.localeCompare(b.id)));
    expect(await repo.countUserMessagesSince(BUSINESS, new Date('2026-11-19T00:00:00.000Z'))).toBe(
      1,
    );
    expect(await repo.countUserMessagesSince(BUSINESS, new Date('2026-11-19T11:00:00.000Z'))).toBe(
      0,
    );
  });

  test('AJ-1 end to end on MySQL in fake mode: the chat completes the profile and creates a Plan', async () => {
    const analytics = new RecordingAnalyticsTracker();
    const geocoder = new FixtureGeocoder();
    const profile = createProfile({
      db,
      clock,
      ids,
      analytics,
      geocoder,
      businesses: new InMemoryBusinessNames({ [BUSINESS]: 'Sweet Supply Co' }),
    });
    const planDrafter = new FakePlanDrafter();
    const { chat } = createAssistant({
      db,
      clock,
      ids,
      profile: { ...profile.profileQueries, ...profile.profileCommands },
      llm: ScriptedLlmClient.fakeMode(),
      geocoder,
      planDrafter,
    });
    const { id } = await chat.getWelcome(owner());
    for (const text of ['Cane sugar and powdered sugar', 'Austin, TX', '3 miles', 'Restaurants']) {
      tick();
      await chat.send(owner(), id, { text });
    }
    tick();
    const done = await chat.send(owner(), id, {
      text: 'Bakeries within 3 miles that could buy our cane sugar',
    });
    expect(done.planId).toBe(PLAN_ID);
    expect(done.profile).toMatchObject({
      location: { label: 'Austin, TX', lat: 30.2672, lng: -97.7431 },
      deliveryRadiusMiles: 3,
      complete: true,
    });
    expect(analytics.events.map((e) => [e.name, e.properties])).toEqual([
      ['profile_completed', { business_id: BUSINESS, via: 'chat', messages_count: 3 }],
    ]);
    const history = (await chat.getWelcome(owner())).messages;
    expect(history).toHaveLength(11);
    expect(history.at(-1)?.text).toMatch(/plan is ready/i);
  });
});
