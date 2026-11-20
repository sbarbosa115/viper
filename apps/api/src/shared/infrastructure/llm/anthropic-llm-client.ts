import Anthropic from '@anthropic-ai/sdk';
import {
  LlmUnavailableError,
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
  type LlmRole,
} from '../../application/llm-client.js';

/** platform's SettingsReader `ai()` (Platform settings → AI models, ADR 0012). */
export interface AiSettingsSource {
  ai(): Promise<{
    readonly anthropicApiKey: string | null;
    readonly planningModel: string;
    readonly chatModel: string;
    readonly fastModel: string;
  }>;
}

/** The part of the SDK client this adapter uses (stubbed in tests; no network). */
export interface MessagesApi {
  create(
    params: Anthropic.MessageCreateParamsNonStreaming,
    options?: { timeout?: number; maxRetries?: number },
  ): Promise<Anthropic.Message>;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 1_024;

/**
 * The chat and extraction turns are short and latency-bound (NFR-2: p95 < 12 s), so they run at
 * low effort; planning keeps the model's default.
 */
const EFFORT: Record<LlmRole, Anthropic.OutputConfig['effort'] | undefined> = {
  planning: undefined,
  chat: 'low',
  fast: 'low',
};

function modelFor(role: LlmRole, ai: Awaited<ReturnType<AiSettingsSource['ai']>>): string {
  if (role === 'planning') return ai.planningModel;
  if (role === 'chat') return ai.chatModel;
  return ai.fastModel;
}

/** Maps a port request to Messages API params (exported for the request-mapping test). */
export function toMessageParams(
  request: LlmRequest,
  model: string,
): Anthropic.MessageCreateParamsNonStreaming {
  const effort = EFFORT[request.role];
  const tools = request.tools ?? [];
  return {
    model,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: request.system,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    ...(tools.length > 0
      ? {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: { type: 'object' as const, ...t.inputSchema },
          })),
          // Forced tool choice ("any"/"tool") is rejected by current models: ask for the tool in
          // the prompt and let the model choose; one call at most.
          tool_choice: { type: 'auto' as const, disable_parallel_tool_use: true },
        }
      : {}),
    ...(effort ? { output_config: { effort } } : {}),
  };
}

/** Maps a Messages API response back to the port's shape. */
export function fromMessage(message: Anthropic.Message): LlmResponse {
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const tool = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  return {
    text,
    ...(tool ? { toolCall: { name: tool.name, input: tool.input } } : {}),
    usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    model: message.model,
  };
}

/**
 * LlmClient on the Anthropic Messages API. The key and model ids come from Platform settings on
 * every call (the reader caches them), so a key change needs no restart. A timeout, a network
 * failure or an API error becomes LlmUnavailableError; the key is never logged or put in errors.
 */
export class AnthropicLlmClient implements LlmClient {
  private cached: { apiKey: string; api: MessagesApi } | null = null;

  constructor(
    private readonly deps: {
      settings: AiSettingsSource;
      /** Builds the SDK's messages API for a key (tests pass a stub). */
      createApi?: (apiKey: string) => MessagesApi;
    },
  ) {}

  private api(apiKey: string): MessagesApi {
    if (this.cached?.apiKey !== apiKey) {
      const create =
        this.deps.createApi ?? ((key: string) => new Anthropic({ apiKey: key }).messages);
      this.cached = { apiKey, api: create(apiKey) };
    }
    return this.cached.api;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const ai = await this.deps.settings.ai();
    if (!ai.anthropicApiKey) {
      throw new LlmUnavailableError('The Anthropic API key is not set in Platform settings');
    }
    const params = toMessageParams(request, modelFor(request.role, ai));
    try {
      const message = await this.api(ai.anthropicApiKey).create(params, {
        timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        // One attempt inside the time limit; the Member's Retry is the retry.
        maxRetries: 0,
      });
      return fromMessage(message);
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionTimeoutError) {
        throw new LlmUnavailableError(`${request.purpose}: the model timed out`);
      }
      if (error instanceof Anthropic.APIError) {
        const status = typeof error.status === 'number' ? ` (${error.status})` : '';
        throw new LlmUnavailableError(`${request.purpose}: the model is unavailable${status}`);
      }
      throw error;
    }
  }
}
