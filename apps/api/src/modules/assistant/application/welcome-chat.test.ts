import { describe, expect, test } from 'vitest';
import { LlmUnavailableError } from '../../../shared/application/llm-client.js';
import { ScriptedLlmClient } from '../../../shared/infrastructure/llm/scripted-llm-client.js';
import {
  assistantFixture,
  BUSINESS,
  extract,
  OTHER_BUSINESS,
  owner,
  OWNER_ID,
  PLAN_ID,
  reply,
} from '../test/assistant-fixture.js';

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'resolved',
    (e: unknown) => (e as { code?: string }).code ?? String(e),
  );

/** The kept message id of a send that failed with ASSISTANT_UNAVAILABLE. */
async function unavailableMessageId(sending: Promise<unknown>): Promise<string> {
  const error = (await sending.then(
    () => ({}),
    (e: unknown) => e,
  )) as { code?: string; details?: { messageId?: string } };
  expect(error.code).toBe('ASSISTANT_UNAVAILABLE');
  return error.details?.messageId ?? '';
}

describe('FR-14: welcome Conversation', () => {
  test('created on first read with the first question; reading again changes nothing', async () => {
    const { chat, llm } = assistantFixture();
    const first = await chat.getWelcome(owner());
    expect(first.profileComplete).toBe(false);
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0]).toMatchObject({ role: 'assistant' });
    expect(first.messages[0]?.text).toMatch(/Sweet Supply Co.*What do you sell\?/);
    expect(await chat.getWelcome(owner())).toEqual(first);
    expect(llm.requests).toHaveLength(0);
  });

  test('each Business has its own Conversation; another Business gets NOT_FOUND', async () => {
    const { chat } = assistantFixture();
    const mine = await chat.getWelcome(owner());
    const theirs = await chat.getWelcome(owner({ businessId: OTHER_BUSINESS }));
    expect(theirs.id).not.toBe(mine.id);
    expect(
      await codeOf(chat.send(owner({ businessId: OTHER_BUSINESS }), mine.id, { text: 'hi' })),
    ).toBe('NOT_FOUND');
  });

  test('a Member without the owner role is refused', async () => {
    const { chat } = assistantFixture();
    expect(await codeOf(chat.getWelcome(owner({ roles: [] })))).toBe('FORBIDDEN');
  });

  test('AC: the scripted fake LLM for a sugar distributor fills the profile; profile_completed fires via chat', async () => {
    const llm = new ScriptedLlmClient();
    const f = assistantFixture({ llm });
    const { id } = await f.chat.getWelcome(owner());

    llm.enqueue(
      extract({
        products: [{ name: 'Cane sugar, 50 lb bag' }, { name: 'Powdered sugar, 25 lb bag' }],
        category: 'Food wholesale',
      }),
      reply('Great. Where are you located?', ['Austin, TX']),
    );
    const t1 = await f.chat.send(owner(), id, { text: 'We sell cane sugar and powdered sugar' });
    expect(t1.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(t1.messages[1]).toMatchObject({
      text: 'Great. Where are you located?',
      quickReplies: ['Austin, TX'],
    });
    expect(t1.profile.products.map((p) => p.name)).toEqual([
      'Cane sugar, 50 lb bag',
      'Powdered sugar, 25 lb bag',
    ]);
    expect(llm.requests[0]).toMatchObject({ role: 'fast', purpose: 'assistant.extract' });
    expect(llm.requests[0]?.system).toContain('Question just asked: products');
    expect(llm.requests[0]?.messages).toEqual([
      { role: 'user', content: 'We sell cane sugar and powdered sugar' },
    ]);
    expect(llm.requests[1]).toMatchObject({ role: 'chat', purpose: 'assistant.reply' });
    expect(llm.requests[1]?.system).toContain('Next question: location');
    expect(llm.requests[1]?.system).toContain('Cane sugar, 50 lb bag');

    llm.enqueue(
      extract({
        locationQuery: '1200 E 6th St, Austin TX',
        addressLine1: '1200 E 6th St',
        city: 'Austin',
        state: 'TX',
      }),
      reply('How far do you deliver?', ['3 miles', '10 miles']),
    );
    const t2 = await f.chat.send(owner(), id, { text: "We're at 1200 E 6th St, Austin TX" });
    expect(t2.profile.location).toEqual({
      lat: 30.2624,
      lng: -97.7262,
      label: '1200 E 6th St, Austin, TX 78702',
    });
    expect(t2.profileComplete).toBe(false);

    llm.enqueue(extract({ deliveryRadiusMiles: 3 }), reply('Who buys from you today?'));
    const t3 = await f.chat.send(owner(), id, { text: 'Within 3 miles' });
    expect(t3.profile.deliveryRadiusMiles).toBe(3);
    expect(t3.profileComplete).toBe(true);
    expect(llm.requests[5]?.system).toContain('Next question: currentCustomers');
    expect(f.analytics.events).toEqual([
      {
        name: 'profile_completed',
        actor: { memberId: OWNER_ID, businessId: BUSINESS },
        properties: { business_id: BUSINESS, via: 'chat', messages_count: 3 },
      },
    ]);

    llm.enqueue(extract({ currentCustomers: 'Restaurants' }), reply('Who would you like to find?'));
    const t4 = await f.chat.send(owner(), id, { text: 'Mostly restaurants' });
    expect(t4.profile.currentCustomers).toBe('Restaurants');
    expect(llm.requests[7]?.system).toContain('Next question: goal');
    expect(t4.messages[1]?.quickReplies).toEqual([
      'Bakeries within 3 miles that could buy our cane sugar',
      'Restaurants within 3 miles that could buy our powdered sugar',
      'Coffee shops within 3 miles that could buy our cane sugar',
    ]);
    expect(t4.planId).toBeNull();

    llm.enqueue(extract({ goal: 'Bakeries within 3 miles that could buy our cane sugar' }));
    const t5 = await f.chat.send(owner(), id, {
      text: 'Bakeries within 3 miles that could buy our cane sugar',
    });
    expect(t5.planId).toBe(PLAN_ID);
    expect(f.planDrafter.goals).toEqual([
      { actor: owner(), goal: 'Bakeries within 3 miles that could buy our cane sugar' },
    ]);
    expect(t5.messages[1]?.text).toMatch(/plan is ready/i);
    expect(llm.pending).toBe(0);
    expect(f.analytics.events).toHaveLength(1);
    expect(f.usage).toHaveLength(9);
    expect(f.usage[0]).toEqual({
      businessId: BUSINESS,
      purpose: 'assistant.extract',
      model: 'scripted',
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  test('AJ-1 in fake mode (TOOLS_MODE=fake): the whole chat walks without a key', async () => {
    const f = assistantFixture({ llm: ScriptedLlmClient.fakeMode() });
    const { id } = await f.chat.getWelcome(owner());
    await f.chat.send(owner(), id, { text: 'Cane sugar and powdered sugar' });
    await f.chat.send(owner(), id, { text: 'Austin, TX' });
    const radius = await f.chat.send(owner(), id, { text: '3 miles' });
    expect(radius.profileComplete).toBe(true);
    const goalQuestion = await f.chat.send(owner(), id, { text: 'Restaurants' });
    expect(goalQuestion.messages[1]?.text).toContain('Who would you like to find?');
    expect(goalQuestion.messages[1]?.quickReplies[0]).toBe(
      'Bakeries within 3 miles that could buy our cane sugar',
    );
    expect(goalQuestion.profile).toMatchObject({
      location: { label: 'Austin, TX' },
      deliveryRadiusMiles: 3,
      currentCustomers: 'Restaurants',
      complete: true,
    });
    const plan = await f.chat.send(owner(), id, {
      text: 'Bakeries within 3 miles that could buy our cane sugar',
    });
    expect(plan.planId).toBe(PLAN_ID);
    expect(f.analytics.events[0]?.properties).toMatchObject({ via: 'chat', messages_count: 3 });
  });

  test('a skipped "who buys today" goes to the Goal', async () => {
    const f = assistantFixture({ llm: ScriptedLlmClient.fakeMode() });
    await f.profile.profileCommands.applyUpdates(BUSINESS, {
      addProducts: [{ name: 'Sugar' }],
      location: { lat: 30.2672, lng: -97.7431, label: 'Austin, TX' },
      deliveryRadiusMiles: 3,
    });
    const { id, messages } = await f.chat.getWelcome(owner());
    expect(messages[0]?.text).toContain('Who buys from you today?');
    f.llm.enqueue(extract({}));
    const next = await f.chat.send(owner(), id, { text: 'Rather not say' });
    expect(f.llm.requests.at(-1)?.system).toContain('Next question: goal');
    expect(next.messages[1]?.quickReplies).toHaveLength(3);
  });

  test('an off-topic message keeps the question and is steered back', async () => {
    const llm = new ScriptedLlmClient();
    const f = assistantFixture({ llm });
    const { id } = await f.chat.getWelcome(owner());
    llm.enqueue(extract({}), reply("I can't check the weather, but tell me: what do you sell?"));
    const res = await f.chat.send(owner(), id, { text: "What's the weather like?" });
    expect(llm.requests[1]?.system).toContain('Next question: products');
    expect(llm.requests[1]?.system).toContain('off-topic');
    expect(res.messages[1]?.text).toContain('what do you sell?');
  });
});

describe('FR-14: geocoding the place', () => {
  test('an ambiguous place asks to confirm; picking the candidate sets the location', async () => {
    const llm = new ScriptedLlmClient();
    const f = assistantFixture({ llm });
    await f.profile.profileCommands.applyUpdates(BUSINESS, { addProducts: [{ name: 'Sugar' }] });
    const { id } = await f.chat.getWelcome(owner());

    llm.enqueue(extract({ locationQuery: 'Springfield' }), reply('Which Springfield?', ['Wrong']));
    const ask = await f.chat.send(owner(), id, { text: 'Springfield' });
    expect(ask.profile.location).toBeNull();
    expect(ask.messages[1]?.quickReplies).toEqual(['Springfield, IL']);
    expect(llm.requests[1]?.system).toContain('Next question: locationConfirm');
    expect(llm.requests[1]?.system).toContain('Place candidates:\n- Springfield, IL');

    llm.enqueue(extract({ locationQuery: 'Springfield, IL' }), reply('How far do you deliver?'));
    const confirmed = await f.chat.send(owner(), id, { text: 'Springfield, IL' });
    expect(llm.requests[2]?.system).toContain('Question just asked: locationConfirm');
    expect(confirmed.profile.location).toEqual({
      lat: 39.7817,
      lng: -89.6501,
      label: 'Springfield, IL',
    });
  });

  test('a place that cannot be found asks again with a note', async () => {
    const llm = new ScriptedLlmClient();
    const f = assistantFixture({ llm });
    await f.profile.profileCommands.applyUpdates(BUSINESS, { addProducts: [{ name: 'Sugar' }] });
    const { id } = await f.chat.getWelcome(owner());
    llm.enqueue(extract({ locationQuery: 'Atlantis' }), reply('Hmm, where exactly?'));
    const res = await f.chat.send(owner(), id, { text: 'Atlantis' });
    expect(res.profile.location).toBeNull();
    expect(llm.requests[1]?.system).toContain(`We couldn't find "Atlantis"`);
    expect(llm.requests[1]?.system).toContain('Next question: location');
  });
});

describe('FR-14: Claude unavailable or slow', () => {
  test('AC: on a timeout the user message is kept and Retry resends it', async () => {
    const llm = new ScriptedLlmClient();
    const f = assistantFixture({ llm });
    const { id } = await f.chat.getWelcome(owner());

    llm.failNext();
    const failedId = await unavailableMessageId(
      f.chat.send(owner(), id, { text: 'We sell cane sugar' }),
    );
    const kept = await f.chat.getWelcome(owner());
    expect(kept.messages.map((m) => [m.role, m.text])).toEqual([
      ['assistant', expect.any(String)],
      ['user', 'We sell cane sugar'],
    ]);
    const messageId = kept.messages[1]?.id ?? '';
    expect(failedId).toBe(messageId);

    llm.enqueue(extract({ products: [{ name: 'Cane sugar' }] }), reply('Where are you located?'));
    const retried = await f.chat.send(owner(), id, {
      text: 'We sell cane sugar',
      retryOfMessageId: messageId,
    });
    expect(retried.messages[0]?.id).toBe(messageId);
    expect(retried.profile.products.map((p) => p.name)).toEqual(['Cane sugar']);
    expect((await f.chat.getWelcome(owner())).messages).toHaveLength(3);
    expect(llm.requests[1]?.messages.at(-1)).toEqual({
      role: 'user',
      content: 'We sell cane sugar',
    });
  });

  test('a failed reply after the updates keeps them; Retry does not add Products twice', async () => {
    const llm = new ScriptedLlmClient();
    const f = assistantFixture({ llm });
    const { id } = await f.chat.getWelcome(owner());
    llm.enqueue(extract({ products: [{ name: 'Cane sugar' }] }), new LlmUnavailableError('slow'));
    const userId = await unavailableMessageId(f.chat.send(owner(), id, { text: 'Cane sugar' }));
    llm.enqueue(extract({ products: [{ name: 'Cane sugar' }] }), reply('Where are you located?'));
    const res = await f.chat.send(owner(), id, { text: 'Cane sugar', retryOfMessageId: userId });
    expect(res.profile.products).toHaveLength(1);
  });

  test('Retry of a message that was answered, or of another Conversation’s message → NOT_FOUND', async () => {
    const llm = ScriptedLlmClient.fakeMode();
    const f = assistantFixture({ llm });
    const { id } = await f.chat.getWelcome(owner());
    const answered = await f.chat.send(owner(), id, { text: 'Cane sugar' });
    expect(
      await codeOf(
        f.chat.send(owner(), id, { text: 'x', retryOfMessageId: answered.messages[0]?.id ?? '' }),
      ),
    ).toBe('NOT_FOUND');
  });

  test('planning failing with ASSISTANT_UNAVAILABLE keeps the goal message for Retry', async () => {
    const f = assistantFixture({ llm: ScriptedLlmClient.fakeMode() });
    await f.profile.profileCommands.applyUpdates(BUSINESS, {
      addProducts: [{ name: 'Sugar' }],
      location: { lat: 30.2672, lng: -97.7431, label: 'Austin, TX' },
      deliveryRadiusMiles: 3,
      currentCustomers: 'Restaurants',
    });
    const { id } = await f.chat.getWelcome(owner());
    f.planDrafter.failWith = new LlmUnavailableError('planning model down');
    const goal = 'Bakeries within 3 miles that could buy our sugar';
    const messageId = await unavailableMessageId(f.chat.send(owner(), id, { text: goal }));
    f.planDrafter.failWith = null;
    const res = await f.chat.send(owner(), id, { text: goal, retryOfMessageId: messageId });
    expect(res.planId).toBe(PLAN_ID);
  });
});

describe('FR-14: 60 user messages per day per Business', () => {
  test('the 61st message of the day → TOO_MANY_REQUESTS; the next day works again', async () => {
    const f = assistantFixture({ llm: ScriptedLlmClient.fakeMode() });
    const { id } = await f.chat.getWelcome(owner());
    for (let i = 0; i < 60; i += 1) {
      await f.conversations.addMessage({
        id: `00000000-0000-7000-8000-${(0xf000 + i).toString(16).padStart(12, '0')}`,
        conversationId: id,
        role: 'user',
        text: 'hi',
        quickReplies: [],
        topic: null,
        createdAt: f.clock.now(),
      });
    }
    const before = (await f.chat.getWelcome(owner())).messages.length;
    expect(await codeOf(f.chat.send(owner(), id, { text: 'one more' }))).toBe('TOO_MANY_REQUESTS');
    expect((await f.chat.getWelcome(owner())).messages).toHaveLength(before);

    f.clock.set(new Date('2026-11-20T00:00:01.000Z'));
    expect((await f.chat.send(owner(), id, { text: 'Cane sugar' })).messages).toHaveLength(2);
  });

  test('the limit counts per Business', async () => {
    const f = assistantFixture({ llm: ScriptedLlmClient.fakeMode(), limit: 1 });
    const mine = await f.chat.getWelcome(owner());
    await f.chat.send(owner(), mine.id, { text: 'Cane sugar' });
    expect(await codeOf(f.chat.send(owner(), mine.id, { text: 'More' }))).toBe('TOO_MANY_REQUESTS');
    const other = owner({ businessId: OTHER_BUSINESS });
    const theirs = await f.chat.getWelcome(other);
    expect((await f.chat.send(other, theirs.id, { text: 'Desks' })).messages).toHaveLength(2);
  });
});
