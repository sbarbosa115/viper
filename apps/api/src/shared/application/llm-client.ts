/**
 * Port to a large language model (Claude via the Anthropic API in production; a scripted fake in
 * tests and dev with TOOLS_MODE=fake). Use cases never import the SDK.
 */
export type LlmRole = 'planning' | 'chat' | 'fast';

export interface LlmMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface LlmToolSpec {
  readonly name: string;
  readonly description: string;
  /** JSON Schema of the tool input. */
  readonly inputSchema: Record<string, unknown>;
}

export interface LlmRequest {
  /** Which configured model to use (Platform settings → AI models). */
  readonly role: LlmRole;
  readonly system: string;
  readonly messages: readonly LlmMessage[];
  /** Structured output: the model must call exactly one of these tools. */
  readonly tools?: readonly LlmToolSpec[];
  readonly maxTokens?: number;
  /** Abort after this many ms (default 30 000). */
  readonly timeoutMs?: number;
  /** For metering and logs (e.g. "assistant.welcome", "planning.draft"). */
  readonly purpose: string;
}

export interface LlmResponse {
  readonly text: string;
  /** Present when the model called a tool. */
  readonly toolCall?: { readonly name: string; readonly input: unknown };
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  readonly model: string;
}

/** Thrown by adapters when the model is unavailable or times out (maps to ASSISTANT_UNAVAILABLE). */
export class LlmUnavailableError extends Error {
  readonly code = 'LLM_UNAVAILABLE';
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}
