import { describe, expect, test } from 'vitest';
import { LlmUnavailableError, type LlmRequest } from '../../application/llm-client.js';
import { ScriptedLlmClient } from './scripted-llm-client.js';

const req = (purpose: string, system = '', text = ''): LlmRequest => ({
  role: 'fast',
  purpose,
  system,
  messages: [{ role: 'user', content: text }],
});

describe('ScriptedLlmClient', () => {
  test('answers queued steps in order and records the requests', async () => {
    const llm = new ScriptedLlmClient()
      .enqueue({ text: 'one' }, ScriptedLlmClient.toolCall('t', { a: 1 }), (r) => ({
        text: r.purpose,
      }))
      .failNext();
    expect((await llm.complete(req('a'))).text).toBe('one');
    expect((await llm.complete(req('b'))).toolCall).toEqual({ name: 't', input: { a: 1 } });
    expect((await llm.complete(req('c'))).text).toBe('c');
    await expect(llm.complete(req('d'))).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(llm.requests.map((r) => r.purpose)).toEqual(['a', 'b', 'c', 'd']);
    expect(llm.pending).toBe(0);
  });

  test('without a queued step and no fallback it fails loudly', async () => {
    await expect(new ScriptedLlmClient().complete(req('x'))).rejects.toThrow(/no response queued/);
  });

  test('fake mode extracts a sugar distributor and asks the next question', async () => {
    const llm = ScriptedLlmClient.fakeMode();
    const products = await llm.complete(
      req('assistant.extract', 'Question just asked: products', 'Cane sugar and powdered sugar'),
    );
    expect(products.toolCall?.input).toEqual({
      products: [
        { name: 'Cane sugar, 50 lb bag', description: '' },
        { name: 'Powdered sugar, 25 lb bag', description: '' },
      ],
    });
    const radius = await llm.complete(
      req('assistant.extract', 'Question just asked: radius', '3 miles'),
    );
    expect(radius.toolCall?.input).toEqual({ deliveryRadiusMiles: 3 });
    const reply = await llm.complete(
      req(
        'assistant.reply',
        'Next question: goal\nSuggested goals:\n- Bakeries near you\n- Cafés\n\nMore',
      ),
    );
    expect(reply.toolCall?.input).toEqual({
      text: 'Your profile is complete. Who would you like to find?',
      quickReplies: ['Bakeries near you', 'Cafés'],
    });
    expect((await llm.complete(req('planning.draft'))).text).toBe('OK');
  });
});
