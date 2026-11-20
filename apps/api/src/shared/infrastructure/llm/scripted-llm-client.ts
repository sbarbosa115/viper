import {
  LlmUnavailableError,
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
} from '../../application/llm-client.js';
import { fakeModeAnswer } from './fake-mode.js';

/** One queued answer: a response (missing fields get defaults), an error to throw, or a function. */
export type ScriptedStep =
  | Partial<LlmResponse>
  | Error
  | ((request: LlmRequest) => Partial<LlmResponse> | Promise<Partial<LlmResponse>>);

function complete(partial: Partial<LlmResponse>): LlmResponse {
  return {
    text: partial.text ?? '',
    ...(partial.toolCall ? { toolCall: partial.toolCall } : {}),
    usage: partial.usage ?? { inputTokens: 0, outputTokens: 0 },
    model: partial.model ?? 'scripted',
  };
}

/**
 * Fake LlmClient (ADR 0005: tests never call Claude). Tests queue canned responses and read the
 * requests it received. With a fallback (fake mode, TOOLS_MODE=fake) it answers anything not
 * queued, so the app works without an API key.
 */
export class ScriptedLlmClient implements LlmClient {
  readonly requests: LlmRequest[] = [];
  private readonly queue: ScriptedStep[] = [];

  constructor(private readonly fallback?: (request: LlmRequest) => Partial<LlmResponse>) {}

  /**
   * Dev and e2e with TOOLS_MODE=fake: drafts Plans from a Goal (fake-plan-draft.ts) and walks the
   * welcome chat deterministically for a sugar distributor (fake-welcome-chat.ts).
   */
  static fakeMode(): ScriptedLlmClient {
    return new ScriptedLlmClient(fakeModeAnswer);
  }

  /** A response that calls a tool (structured output). */
  static toolCall(name: string, input: unknown): Partial<LlmResponse> {
    return { toolCall: { name, input } };
  }

  enqueue(...steps: ScriptedStep[]): this {
    this.queue.push(...steps);
    return this;
  }

  /** The next call fails like a timeout (LlmUnavailableError). */
  failNext(times = 1): this {
    for (let i = 0; i < times; i += 1) {
      this.queue.push(new LlmUnavailableError('Scripted timeout'));
    }
    return this;
  }

  get pending(): number {
    return this.queue.length;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const step = this.queue.shift();
    if (step === undefined) {
      if (this.fallback) return complete(this.fallback(request));
      throw new Error(`ScriptedLlmClient: no response queued for "${request.purpose}"`);
    }
    if (step instanceof Error) throw step;
    return complete(typeof step === 'function' ? await step(request) : step);
  }
}
