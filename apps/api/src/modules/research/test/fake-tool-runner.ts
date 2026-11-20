import {
  LlmUnavailableError,
  type LlmClient,
  type LlmRequest,
} from '../../../shared/application/llm-client.js';
import type { Clock } from '../../../shared/domain/clock.js';
import type {
  ToolCallLogPort,
  ToolCallRequest,
  ToolCallResult,
  ToolCallView,
  ToolCatalogPort,
  ToolRunnerPort,
} from '../application/ports.js';
import { TOOL_KEYS } from '../domain/local-buyers.js';
import { fixtureOutput } from './bakery-fixtures.js';

/** Millicredits per call of each fake Tool (a simple Rate card). */
export const FAKE_RATES: Readonly<Record<string, number>> = {
  [TOOL_KEYS.googlePlaces]: 4_000,
  [TOOL_KEYS.mapsScraper]: 6_000,
  [TOOL_KEYS.overpass]: 500,
  [TOOL_KEYS.firecrawl]: 1_500,
  [TOOL_KEYS.instagram]: 2_000,
  [TOOL_KEYS.yelp]: 2_000,
  [TOOL_KEYS.apolloPeople]: 2_500,
  [TOOL_KEYS.hunter]: 2_000,
  [TOOL_KEYS.zerobounce]: 800,
  [TOOL_KEYS.twilio]: 600,
};

interface Failure {
  code: string;
  message: string;
  times: number;
  /** Calls that still succeed before the failures start. */
  after: number;
}

/**
 * The tools module as research sees it (ToolRunner, catalog, Tool call log), with fixture
 * outputs. Like the real ToolRunner it answers a repeated call (same run, Step, Tool and input)
 * from storage at 0 credits, and skips a call whose cost exceeds the budget.
 */
export class FakeToolRunner implements ToolRunnerPort, ToolCatalogPort, ToolCallLogPort {
  /** Every call the runner saw, reused or not. */
  readonly calls: (ToolCallView & { runId: string; input: Record<string, unknown> })[] = [];
  /** Calls that reached a provider (the ones that cost money). */
  readonly providerCalls: { toolKey: string; stepKey: string; input: Record<string, unknown> }[] =
    [];
  readonly disabled = new Set<string>();
  readonly unconfigured = new Set<string>();
  /** Runs before each provider call (e.g. to move the clock or simulate a crash). */
  beforeCall: ((request: ToolCallRequest) => void) | null = null;
  /** Millicredits per 1k LLM input tokens (0 = Claude is free in this test). */
  llmRatePer1k = 100;
  /** Millicredits per call, by Tool (tests raise prices to reach guardrails). */
  readonly rates: Record<string, number> = { ...FAKE_RATES };
  private readonly stored = new Map<string, unknown>();
  private readonly failures = new Map<string, Failure>();
  private n = 0;

  constructor(
    private readonly clock: Clock,
    /** Answers `claude.*` calls, like the tools module's Claude adapter does. */
    private readonly llm: LlmClient,
  ) {}

  /** The next `times` calls of a Tool fail with `code` (Infinity = until healed). */
  fail(
    toolKey: string,
    times = Infinity,
    code = 'PROVIDER_ERROR',
    message = 'Provider is down',
  ): this {
    this.failures.set(toolKey, { code, message, times, after: 0 });
    return this;
  }

  /** Like `fail`, after `okCalls` more successful calls (Claude included). */
  failAfter(toolKey: string, okCalls: number, code: string, times = Infinity): this {
    this.failures.set(toolKey, { code, message: code, times, after: okCalls });
    return this;
  }

  private nextFailure(toolKey: string): Failure | null {
    const failure = this.failures.get(toolKey);
    if (!failure || failure.times <= 0) return null;
    if (failure.after > 0) {
      failure.after -= 1;
      return null;
    }
    failure.times -= 1;
    return failure;
  }

  heal(toolKey: string): void {
    this.failures.delete(toolKey);
  }

  callsOf(toolKey: string): number {
    return this.providerCalls.filter((c) => c.toolKey === toolKey).length;
  }

  /** Claude through the runner: metered by input tokens, stored for reuse like any Tool call. */
  private async callClaude(request: ToolCallRequest, key: string): Promise<ToolCallResult> {
    const input = request.input as unknown as Omit<LlmRequest, 'role'>;
    const role = request.toolKey === 'claude.fast' ? 'fast' : 'planning';
    const failure = this.nextFailure(request.toolKey);
    if (failure) {
      return this.record(request, 'error', 0, false, {
        code: failure.code,
        message: failure.message,
      });
    }
    try {
      const response = await this.llm.complete({ ...input, role });
      const output = {
        text: response.text,
        toolCall: response.toolCall ?? null,
        usage: response.usage,
        model: response.model,
      };
      const cost = Math.ceil((response.usage.inputTokens / 1000) * this.llmRatePer1k);
      this.stored.set(key, output);
      return this.record(request, 'ok', cost, false, null, output);
    } catch (error) {
      if (!(error instanceof LlmUnavailableError)) throw error;
      return this.record(request, 'error', 0, false, {
        code: 'PROVIDER_ERROR',
        message: error.message,
        retryable: true,
      });
    }
  }

  call(request: ToolCallRequest): Promise<ToolCallResult> {
    const { toolKey } = request;
    if (this.disabled.has(toolKey)) {
      return Promise.resolve(
        this.record(request, 'skipped', 0, false, {
          code: 'TOOL_DISABLED',
          message: 'Tool disabled',
        }),
      );
    }
    if (this.unconfigured.has(toolKey)) {
      return Promise.resolve(
        this.record(request, 'error', 0, false, {
          code: 'PROVIDER_NOT_CONFIGURED',
          message: 'No key',
        }),
      );
    }
    const key = `${request.runId}|${request.stepKey}|${toolKey}|${JSON.stringify(request.input)}`;
    if (this.stored.has(key)) {
      return Promise.resolve(this.record(request, 'ok', 0, true, null, this.stored.get(key)));
    }
    if (toolKey.startsWith('claude.')) return this.callClaude(request, key);
    const cost = this.rates[toolKey] ?? 1_000;
    if (cost > request.budget.remainingMillicredits) {
      return Promise.resolve(
        this.record(request, 'skipped', 0, false, {
          code: 'BUDGET_EXCEEDED',
          message: 'Over budget',
        }),
      );
    }
    this.beforeCall?.(request);
    this.providerCalls.push({ toolKey, stepKey: request.stepKey, input: { ...request.input } });
    const failure = this.nextFailure(toolKey);
    if (failure) {
      return Promise.resolve(
        this.record(request, 'error', 0, false, { code: failure.code, message: failure.message }),
      );
    }
    const output = fixtureOutput(toolKey, request.input);
    this.stored.set(key, output);
    return Promise.resolve(this.record(request, 'ok', cost, false, null, output));
  }

  availability(toolKeys: readonly string[]): Promise<ReadonlyMap<string, boolean>> {
    return Promise.resolve(
      new Map(toolKeys.map((k) => [k, !this.disabled.has(k) && !this.unconfigured.has(k)])),
    );
  }

  listForRun(runId: string): Promise<ToolCallView[]> {
    return Promise.resolve(this.calls.filter((c) => c.runId === runId));
  }

  private record(
    request: ToolCallRequest,
    status: 'ok' | 'error' | 'skipped',
    millicredits: number,
    reused: boolean,
    error: { code: string; message: string; retryable?: boolean } | null,
    output: unknown = null,
  ): ToolCallResult {
    this.n += 1;
    this.calls.push({
      id: `00000000-0000-7000-9000-${this.n.toString(16).padStart(12, '0')}`,
      runId: request.runId,
      input: { ...request.input },
      stepKey: request.stepKey,
      toolKey: request.toolKey,
      units: status === 'ok' ? 1 : 0,
      millicredits,
      providerCostMicros: Math.round(millicredits / 2),
      status,
      error: error?.message ?? null,
      durationMs: 10,
      createdAt: this.clock.now(),
      attemptN: request.attemptN,
      reused,
    });
    return {
      status,
      output,
      units: status === 'ok' ? 1 : 0,
      millicredits,
      providerCostMicros: Math.round(millicredits / 2),
      reused,
      error,
    };
  }
}
