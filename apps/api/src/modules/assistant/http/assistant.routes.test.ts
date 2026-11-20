import { getWelcomeConversation, sendMessage } from '@app/contracts/assistant';
import { errorResponse } from '@app/contracts/errors';
import { describe, expect, test } from 'vitest';
import { buildTestApp } from '../../../../test/build-test-app.js';
import type { Actor } from '../../../shared/domain/actor.js';
import { ScriptedLlmClient } from '../../../shared/infrastructure/llm/scripted-llm-client.js';
import { assistantFixture, OTHER_BUSINESS, owner } from '../test/assistant-fixture.js';

async function setup(actor?: Actor, options: { limit?: number } = {}) {
  const f = assistantFixture({ llm: ScriptedLlmClient.fakeMode(), ...options });
  const app = await buildTestApp({ modules: [f.module], ...(actor ? { actor } : {}) });
  return { ...f, app };
}

const welcome = async (app: Awaited<ReturnType<typeof setup>>['app']) =>
  getWelcomeConversation.response.parse(
    (await app.inject({ method: 'GET', url: '/api/conversations/welcome' })).json(),
  );

const errorOf = (body: unknown) => errorResponse.parse(body).error;

describe('FR-14: assistant endpoints', () => {
  test('401 when not signed in', async () => {
    const { app } = await setup();
    expect(
      (await app.inject({ method: 'GET', url: '/api/conversations/welcome' })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/conversations/00000000-0000-7000-8000-000000000001/messages',
          payload: { text: 'hi' },
        })
      ).statusCode,
    ).toBe(401);
  });

  test('GET returns the Conversation; POST returns both messages, the profile and planId', async () => {
    const { app } = await setup(owner());
    const conversation = await welcome(app);
    expect(conversation.messages).toHaveLength(1);
    const res = await app.inject({
      method: 'POST',
      url: `/api/conversations/${conversation.id}/messages`,
      payload: { text: 'Cane sugar and powdered sugar' },
    });
    expect(res.statusCode).toBe(200);
    const body = sendMessage.response.parse(res.json());
    expect(body.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(body.profile.products).toHaveLength(2);
    expect(body.profileComplete).toBe(false);
    expect(body.planId).toBeNull();
  });

  test('text 1–2,000 chars (400)', async () => {
    const { app } = await setup(owner());
    const { id } = await welcome(app);
    const url = `/api/conversations/${id}/messages`;
    expect((await app.inject({ method: 'POST', url, payload: { text: '  ' } })).statusCode).toBe(
      400,
    );
    expect(
      (await app.inject({ method: 'POST', url, payload: { text: 'x'.repeat(2001) } })).statusCode,
    ).toBe(400);
  });

  test('503 ASSISTANT_UNAVAILABLE carries the kept message id', async () => {
    const { app, llm } = await setup(owner());
    const { id } = await welcome(app);
    llm.failNext();
    const res = await app.inject({
      method: 'POST',
      url: `/api/conversations/${id}/messages`,
      payload: { text: 'Cane sugar' },
    });
    expect(res.statusCode).toBe(503);
    const error = errorOf(res.json());
    expect(error.code).toBe('ASSISTANT_UNAVAILABLE');
    const kept = await welcome(app);
    expect(error.details).toEqual({ messageId: kept.messages[1]?.id });

    const retry = await app.inject({
      method: 'POST',
      url: `/api/conversations/${id}/messages`,
      payload: { text: 'Cane sugar', retryOfMessageId: kept.messages[1]?.id },
    });
    expect(retry.statusCode).toBe(200);
    expect((await welcome(app)).messages).toHaveLength(3);
  });

  test('429 TOO_MANY_REQUESTS over the daily limit', async () => {
    const { app } = await setup(owner(), { limit: 1 });
    const { id } = await welcome(app);
    const url = `/api/conversations/${id}/messages`;
    expect(
      (await app.inject({ method: 'POST', url, payload: { text: 'Cane sugar' } })).statusCode,
    ).toBe(200);
    const res = await app.inject({ method: 'POST', url, payload: { text: 'More' } });
    expect(res.statusCode).toBe(429);
    expect(errorOf(res.json()).code).toBe('TOO_MANY_REQUESTS');
  });

  test('cross-Business: another Business cannot post to or read this Conversation', async () => {
    const f = assistantFixture({ llm: ScriptedLlmClient.fakeMode() });
    const mine = await f.chat.getWelcome(owner());
    const app = await buildTestApp({
      modules: [f.module],
      actor: owner({ businessId: OTHER_BUSINESS }),
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/conversations/${mine.id}/messages`,
      payload: { text: 'hello' },
    });
    expect(res.statusCode).toBe(404);
    const theirs = await welcome(app);
    expect(theirs.id).not.toBe(mine.id);
    expect((await f.chat.getWelcome(owner())).messages).toHaveLength(1);
  });
});
