import {
  LlmUnavailableError,
  type LlmClient,
  type LlmRequest,
} from '../../../../shared/application/llm-client.js';
import type { Clock } from '../../../../shared/domain/clock.js';
import { registerAdapter } from './register.js';
import { ToolFailure, type RegisteredAdapter } from '../../application/tool-adapter.js';
import { claudeInput, claudeOutput } from '../tool-io.js';
import { thousandTokenUnits } from '../../application/llm-usage-meter.js';
import { CLAUDE_TOOLS, type ClaudeRole } from '../../domain/tool-keys.js';

interface Parsed {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tools?: { name: string; description: string; inputSchema: Record<string, unknown> }[] | undefined;
  maxTokens: number;
  purpose: string;
  timeoutMs?: number | undefined;
}

/** A cautious input-token estimate for the budget check (about 3 characters a token). */
function estimatedInputTokens(input: Parsed): number {
  const chars =
    input.system.length +
    input.messages.reduce((n, m) => n + m.content.length, 0) +
    JSON.stringify(input.tools ?? []).length;
  return Math.ceil(chars / 3);
}

/**
 * Claude for a run Step, through the LlmClient port (AnthropicLlmClient live, the scripted fake
 * with TOOLS_MODE=fake). Metered by tokens: input on `claude.<role>`, output on `claude.<role>.out`.
 */
export function claudeAdapter(
  role: ClaudeRole,
  deps: { llm: LlmClient; clock: Clock },
): RegisteredAdapter {
  const keys = CLAUDE_TOOLS[role];
  return registerAdapter({
    key: keys.in,
    requires: 'anthropic',
    input: claudeInput,
    output: claudeOutput,
    maxUnits: (input: Parsed) => thousandTokenUnits(estimatedInputTokens(input)),
    maxMeters: (input: Parsed) => [
      { toolKey: keys.out, units: thousandTokenUnits(input.maxTokens) },
    ],
    async run(input: Parsed) {
      const request: LlmRequest = {
        role,
        system: input.system,
        messages: input.messages,
        maxTokens: input.maxTokens,
        purpose: input.purpose,
        ...(input.tools ? { tools: input.tools } : {}),
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
      };
      let response;
      try {
        response = await deps.llm.complete(request);
      } catch (error) {
        if (error instanceof LlmUnavailableError) throw ToolFailure.retryable(error.message);
        throw error;
      }
      return {
        output: {
          text: response.text,
          toolCall: response.toolCall ?? null,
          usage: response.usage,
          model: response.model,
          source: { name: 'Claude', url: null, retrievedAt: deps.clock.now().toISOString() },
        },
        units: thousandTokenUnits(response.usage.inputTokens),
        meters: [{ toolKey: keys.out, units: thousandTokenUnits(response.usage.outputTokens) }],
      };
    },
  });
}
