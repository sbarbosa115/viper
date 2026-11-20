import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, test } from 'vitest';
import { LlmUnavailableError, type LlmRequest } from '../../application/llm-client.js';
import { AnthropicLlmClient, type MessagesApi } from './anthropic-llm-client.js';

const KEY = 'sk-ant-test-key-0001';
const settings = (apiKey: string | null = KEY) => ({
  ai: () =>
    Promise.resolve({
      anthropicApiKey: apiKey,
      planningModel: 'claude-opus-5-5',
      chatModel: 'claude-sonnet-5-5',
      fastModel: 'claude-haiku-5-5',
    }),
});

/** A Messages API response with only the fields the adapter reads. */
function message(content: unknown[], model = 'claude-haiku-5-5'): Anthropic.Message {
  // The SDK's Message has many fields the adapter ignores; the test builds the ones it reads.
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: 'end_turn',
    usage: { input_tokens: 120, output_tokens: 30 },
  } as unknown as Anthropic.Message;
}

class StubMessages implements MessagesApi {
  readonly calls: { params: Anthropic.MessageCreateParamsNonStreaming; options: unknown }[] = [];
  readonly keys: string[] = [];
  constructor(private readonly answer: () => Promise<Anthropic.Message>) {}
  create(params: Anthropic.MessageCreateParamsNonStreaming, options?: unknown) {
    this.calls.push({ params, options });
    return this.answer();
  }
}

function build(answer: () => Promise<Anthropic.Message>, apiKey: string | null = KEY) {
  const stub = new StubMessages(answer);
  const client = new AnthropicLlmClient({
    settings: settings(apiKey),
    createApi: (key) => {
      stub.keys.push(key);
      return stub;
    },
  });
  return { client, stub };
}

const extractRequest: LlmRequest = {
  role: 'fast',
  purpose: 'assistant.extract',
  system: 'Extract profile updates.',
  messages: [
    { role: 'assistant', content: 'What do you sell?' },
    { role: 'user', content: 'Cane sugar' },
  ],
  tools: [
    {
      name: 'record_profile_updates',
      description: 'Record updates',
      inputSchema: { properties: { city: { type: ['string', 'null'] } } },
    },
  ],
  maxTokens: 512,
  timeoutMs: 5_000,
};

describe('AnthropicLlmClient: request mapping', () => {
  test('maps role → model, system, messages, tools (auto choice) and effort', async () => {
    const { client, stub } = build(() =>
      Promise.resolve(
        message([
          { type: 'tool_use', id: 't1', name: 'record_profile_updates', input: { city: 'Austin' } },
        ]),
      ),
    );
    const res = await client.complete(extractRequest);

    expect(stub.keys).toEqual([KEY]);
    expect(stub.calls[0]?.params).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 512,
      system: 'Extract profile updates.',
      messages: [
        { role: 'assistant', content: 'What do you sell?' },
        { role: 'user', content: 'Cane sugar' },
      ],
      tools: [
        {
          name: 'record_profile_updates',
          description: 'Record updates',
          input_schema: { type: 'object', properties: { city: { type: ['string', 'null'] } } },
        },
      ],
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
      output_config: { effort: 'low' },
    });
    expect(stub.calls[0]?.options).toEqual({ timeout: 5_000, maxRetries: 0 });
    expect(res).toEqual({
      text: '',
      toolCall: { name: 'record_profile_updates', input: { city: 'Austin' } },
      usage: { inputTokens: 120, outputTokens: 30 },
      model: 'claude-haiku-5-5',
    });
  });

  test('chat and planning roles; no tools → no tool_choice; default timeout 30 s', async () => {
    const { client, stub } = build(() =>
      Promise.resolve(
        message([
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'there' },
        ]),
      ),
    );
    const chat = await client.complete({
      role: 'chat',
      purpose: 'assistant.reply',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
    });
    await client.complete({
      role: 'planning',
      purpose: 'planning.draft',
      system: 's',
      messages: [],
    });

    expect(chat.text).toBe('Hello there');
    expect(chat.toolCall).toBeUndefined();
    expect(stub.calls[0]?.params).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 1024,
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      output_config: { effort: 'low' },
    });
    expect(stub.calls[0]?.options).toEqual({ timeout: 30_000, maxRetries: 0 });
    expect(stub.calls[1]?.params.model).toBe('claude-opus-5-5');
    expect(stub.calls[1]?.params).not.toHaveProperty('output_config');
    expect(stub.keys).toEqual([KEY]);
  });
});

describe('AnthropicLlmClient: failures', () => {
  test('a timeout becomes LlmUnavailableError', async () => {
    const { client } = build(() => Promise.reject(new Anthropic.APIConnectionTimeoutError()));
    await expect(client.complete(extractRequest)).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  test('an API error becomes LlmUnavailableError without the key in the message', async () => {
    const { client } = build(() =>
      Promise.reject(
        Anthropic.APIError.generate(
          529,
          { error: { type: 'overloaded_error' } },
          `overloaded ${KEY}`,
          new Headers(),
        ),
      ),
    );
    const error = await client.complete(extractRequest).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmUnavailableError);
    expect((error as Error).message).not.toContain(KEY);
    expect((error as Error).message).toContain('529');
  });

  test('no API key in Platform settings → LlmUnavailableError, no call', async () => {
    const { client, stub } = build(() => Promise.resolve(message([])), null);
    await expect(client.complete(extractRequest)).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(stub.calls).toHaveLength(0);
  });

  test('other errors are not hidden', async () => {
    const { client } = build(() => Promise.reject(new TypeError('bug')));
    await expect(client.complete(extractRequest)).rejects.toBeInstanceOf(TypeError);
  });
});
