import type { Clock } from '../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import { Tool } from '../domain/tool.js';
import { CLAUDE_TOOLS, type ClaudeRole } from '../domain/tool-keys.js';
import type { ToolCallRecord, ToolCallRepository, ToolRepository } from './ports.js';
import { inputHash } from './tool-runner.js';

/** One model call's usage (the assistant's `LlmUsage`). */
export interface LlmUsage {
  readonly businessId: string;
  readonly purpose: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** 1k-token units, rounded up (a call of 1 to 1,000 tokens is 1 unit). */
export function thousandTokenUnits(tokens: number): number {
  return Math.ceil(Math.max(0, tokens) / 1000);
}

/**
 * Meters Claude calls made outside a run (welcome chat, plan drafting) as Tool calls with no run
 * (FR-14, G-3). Implements the assistant's `onLlmUsage` listener. These calls are Viper's cost and
 * are never charged to the Business; recording failures are reported, never thrown, so metering
 * can't break the chat.
 */
export class LlmUsageMeter {
  constructor(
    private readonly deps: {
      tools: ToolRepository;
      calls: ToolCallRepository;
      /** Platform settings → AI models: which role a model id is configured for. */
      models: () => Promise<{ planningModel: string; chatModel: string; fastModel: string }>;
      clock: Clock;
      ids: IdGenerator;
      onError?: (error: unknown, usage: LlmUsage) => void;
    },
  ) {}

  async onLlmUsage(usage: LlmUsage): Promise<void> {
    try {
      await this.meter(usage);
    } catch (error) {
      this.deps.onError?.(error, usage);
    }
  }

  private async roleOf(model: string): Promise<ClaudeRole> {
    const models = await this.deps.models();
    if (model === models.planningModel) return 'planning';
    if (model === models.fastModel) return 'fast';
    return 'chat';
  }

  private async meter(usage: LlmUsage): Promise<void> {
    const keys = CLAUDE_TOOLS[await this.roleOf(usage.model)];
    const input = { purpose: usage.purpose, model: usage.model };
    const hash = inputHash(input);
    const now = this.deps.clock.now();
    const rows: ToolCallRecord[] = [];
    for (const [key, tokens] of [
      [keys.in, usage.inputTokens],
      [keys.out, usage.outputTokens],
    ] as const) {
      const snapshot = await this.deps.tools.find(key);
      if (!snapshot) continue;
      const card = Tool.restore(snapshot).rateCard;
      const units = thousandTokenUnits(tokens);
      rows.push({
        id: this.deps.ids.next(),
        runId: null,
        stepKey: null,
        attemptN: null,
        reused: false,
        businessId: usage.businessId,
        toolKey: key,
        inputHash: hash,
        input,
        output:
          key === keys.in
            ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
            : null,
        units,
        millicredits: card.millicreditsFor(units),
        providerCostMicros: card.providerCostMicrosFor(units),
        status: 'ok',
        error: null,
        durationMs: 0,
        createdAt: now,
      });
    }
    if (rows.length > 0) await this.deps.calls.add(rows);
  }
}
