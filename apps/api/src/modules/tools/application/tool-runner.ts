import { createHash } from 'node:crypto';
import type { Clock } from '../../../shared/domain/clock.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import { canonicalJson } from '../domain/canonical-json.js';
import { Tool } from '../domain/tool.js';
import {
  isConfigured,
  type ProviderSettings,
  type Sleeper,
  type ToolCallRecord,
  type ToolCallRepository,
  type ToolCallStatus,
  type ToolRepository,
} from './ports.js';
import {
  ToolFailure,
  type AdapterRegistry,
  type AdapterResult,
  type ToolErrorCode,
} from './tool-adapter.js';

/** FR-20: a provider error is retried up to 3 times, after 1 s, 4 s and 16 s. */
export const RETRY_DELAYS_MS: readonly number[] = [1_000, 4_000, 16_000];

const MAX_ERROR_LENGTH = 1_000;

export interface ToolCallRequest<Tx = never> {
  readonly businessId: string;
  /** Null for calls outside a run (welcome chat, plan drafting). */
  readonly runId: string | null;
  readonly stepKey: string | null;
  readonly attemptN: number | null;
  readonly toolKey: string;
  readonly input: unknown;
  /** The run's Reservation left; a call whose max cost exceeds it is skipped (FR-20). */
  readonly budget?: { readonly remainingMillicredits: number };
  /** Record the Tool call in this transaction (research saves its handoff in the same one). */
  readonly within?: Tx;
}

export interface ToolCallError {
  readonly code: ToolErrorCode;
  readonly message: string;
  /** True when a later attempt may succeed (provider down, rate limited, timeout). */
  readonly retryable: boolean;
}

export interface ToolCallResult<O = unknown> {
  readonly toolCallId: string;
  readonly status: ToolCallStatus;
  readonly output: O | null;
  readonly units: number;
  /** Including companion meters (Claude output tokens). */
  readonly millicredits: number;
  readonly providerCostMicros: number;
  /** Answered from a stored call of this run (same Step, Tool and input): not charged again. */
  readonly reused: boolean;
  readonly error: ToolCallError | null;
}

export interface ToolRunnerDeps<Tx> {
  tools: ToolRepository;
  /** The Tool call repository, on the caller's transaction when one is given. */
  calls: (within?: Tx) => ToolCallRepository;
  adapters: AdapterRegistry;
  settings: ProviderSettings;
  clock: Clock;
  ids: IdGenerator;
  sleeper: Sleeper;
  retryDelaysMs?: readonly number[];
}

/** sha-256 (hex) of the canonical JSON of a Tool input (FR-36). */
export function inputHash(input: unknown): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

function truncate(message: string): string {
  return message.length > MAX_ERROR_LENGTH ? message.slice(0, MAX_ERROR_LENGTH) : message;
}

interface CallContext<Tx> {
  readonly req: ToolCallRequest<Tx>;
  readonly tool: Tool;
  readonly input: unknown;
  readonly inputHash: string;
  readonly startedAt: number;
}

/**
 * The only way Tools are called (FR-23): checks the Tool is enabled and configured, answers
 * repeats from storage, checks the budget, calls the adapter with retries, and records a metered
 * Tool call. It never throws for provider problems: the result carries the error and research
 * decides what to do (FR-20: disable a Tool for the run after 5 failures in a row).
 */
export class ToolRunner<Tx = never> {
  constructor(private readonly deps: ToolRunnerDeps<Tx>) {}

  async call(req: ToolCallRequest<Tx>): Promise<ToolCallResult> {
    const startedAt = this.deps.clock.now().getTime();
    const snapshot = await this.deps.tools.find(req.toolKey);
    const adapter = this.deps.adapters.get(req.toolKey);
    if (!snapshot || !adapter) throw new NotFoundError(`Unknown Tool ${req.toolKey}`);
    const tool = Tool.restore(snapshot);
    const parsed = adapter.parseInput(req.input);
    const input = parsed.ok ? parsed.value : req.input;
    const ctx: CallContext<Tx> = { req, tool, input, inputHash: inputHash(input), startedAt };

    if (!tool.enabled) {
      return this.finish(ctx, 'skipped', failure('TOOL_DISABLED', `${tool.name} is disabled`));
    }
    if (!(await isConfigured(adapter.requires, this.deps.settings))) {
      const message = `${tool.provider} is not configured in Platform settings`;
      return this.finish(ctx, 'error', failure('PROVIDER_NOT_CONFIGURED', message));
    }
    if (!parsed.ok) return this.finish(ctx, 'error', failure('INVALID_INPUT', parsed.message));

    const reused = await this.reuse(ctx);
    if (reused) return reused;

    if (req.budget) {
      const maxCost = await this.maxCost(tool, adapter.maxUnits(input), adapter.maxMeters(input));
      if (maxCost > req.budget.remainingMillicredits) {
        const message = `${tool.name} may cost ${maxCost} millicredits; ${req.budget.remainingMillicredits} left`;
        return this.finish(ctx, 'skipped', failure('BUDGET_EXCEEDED', message));
      }
    }

    const outcome = await this.runWithRetries(() => adapter.run(input));
    if ('error' in outcome) return this.finish(ctx, 'error', outcome.error);
    const output = adapter.parseOutput(outcome.result.output);
    if (!output.ok) {
      return this.finish(ctx, 'error', failure('INVALID_OUTPUT', output.message));
    }
    return this.finish(ctx, 'ok', null, { ...outcome.result, output: output.value });
  }

  private async reuse(ctx: CallContext<Tx>): Promise<ToolCallResult | null> {
    const { req } = ctx;
    if (req.runId === null) return null;
    const calls = this.deps.calls(req.within);
    const stored = await calls.findReusable({
      runId: req.runId,
      stepKey: req.stepKey,
      toolKey: req.toolKey,
      inputHash: ctx.inputHash,
    });
    if (!stored) return null;
    const record = this.record(ctx, {
      toolKey: req.toolKey,
      status: 'ok',
      reused: true,
      output: null,
      units: 0,
      millicredits: 0,
      providerCostMicros: 0,
      error: null,
    });
    await calls.add([record]);
    return {
      toolCallId: record.id,
      status: 'ok',
      output: stored.output,
      units: 0,
      millicredits: 0,
      providerCostMicros: 0,
      reused: true,
      error: null,
    };
  }

  private async maxCost(
    tool: Tool,
    units: number,
    meters: readonly { toolKey: string; units: number }[],
  ): Promise<number> {
    let total = tool.maxCostMillicredits(units);
    for (const meter of meters) {
      const companion = await this.deps.tools.find(meter.toolKey);
      if (companion) total += Tool.restore(companion).maxCostMillicredits(meter.units);
    }
    return total;
  }

  private async runWithRetries(
    run: () => Promise<AdapterResult<unknown>>,
  ): Promise<{ result: AdapterResult<unknown> } | { error: ToolCallError }> {
    const delays = this.deps.retryDelaysMs ?? RETRY_DELAYS_MS;
    for (let attempt = 0; ; attempt++) {
      try {
        return { result: await run() };
      } catch (err) {
        const error = toCallError(err);
        const delay = delays[attempt];
        if (!error.retryable || delay === undefined) return { error };
        await this.deps.sleeper.sleep(delay);
      }
    }
  }

  private async finish(
    ctx: CallContext<Tx>,
    status: ToolCallStatus,
    error: ToolCallError | null,
    result?: AdapterResult<unknown>,
  ): Promise<ToolCallResult> {
    const units = result?.units ?? 0;
    const card = ctx.tool.rateCard;
    const primary = this.record(ctx, {
      toolKey: ctx.tool.key,
      status,
      reused: false,
      output: result ? result.output : null,
      units,
      millicredits: card.millicreditsFor(units),
      providerCostMicros: card.providerCostMicrosFor(units),
      error: error ? `${error.code}: ${error.message}` : null,
    });
    const companions: ToolCallRecord[] = [];
    for (const meter of result?.meters ?? []) {
      const snapshot = await this.deps.tools.find(meter.toolKey);
      if (!snapshot) continue;
      const meterCard = Tool.restore(snapshot).rateCard;
      companions.push(
        this.record(ctx, {
          toolKey: meter.toolKey,
          status: 'ok',
          reused: false,
          output: null,
          units: meter.units,
          millicredits: meterCard.millicreditsFor(meter.units),
          providerCostMicros: meterCard.providerCostMicrosFor(meter.units),
          error: null,
        }),
      );
    }
    await this.deps.calls(ctx.req.within).add([primary, ...companions]);
    const all = [primary, ...companions];
    return {
      toolCallId: primary.id,
      status,
      output: result ? result.output : null,
      units,
      millicredits: all.reduce((sum, r) => sum + r.millicredits, 0),
      providerCostMicros: all.reduce((sum, r) => sum + r.providerCostMicros, 0),
      reused: false,
      error,
    };
  }

  private record(
    ctx: CallContext<Tx>,
    row: Pick<
      ToolCallRecord,
      | 'toolKey'
      | 'status'
      | 'reused'
      | 'output'
      | 'units'
      | 'millicredits'
      | 'providerCostMicros'
      | 'error'
    >,
  ): ToolCallRecord {
    const now = this.deps.clock.now();
    return {
      id: this.deps.ids.next(),
      runId: ctx.req.runId,
      stepKey: ctx.req.stepKey,
      attemptN: ctx.req.attemptN,
      businessId: ctx.req.businessId,
      inputHash: ctx.inputHash,
      input: ctx.input,
      durationMs: Math.max(0, now.getTime() - ctx.startedAt),
      createdAt: now,
      ...row,
      error: row.error === null ? null : truncate(row.error),
    };
  }
}

function failure(code: ToolErrorCode, message: string): ToolCallError {
  return { code, message, retryable: false };
}

function toCallError(err: unknown): ToolCallError {
  if (err instanceof ToolFailure) {
    return { code: err.code, message: truncate(err.message), retryable: err.retryable };
  }
  // An unexpected adapter bug: not retried, recorded for Staff.
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'PROVIDER_ERROR', message: truncate(message), retryable: false };
}
