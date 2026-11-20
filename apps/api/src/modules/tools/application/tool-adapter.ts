import type { ProviderRequirement } from '../domain/tool-keys.js';

/** Why a Tool call did not return output (FR-20, FR-23, FR-36). */
export type ToolErrorCode =
  | 'TOOL_DISABLED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'BUDGET_EXCEEDED'
  | 'PROVIDER_ERROR'
  | 'INVALID_INPUT'
  | 'INVALID_OUTPUT';

/**
 * Thrown by adapters. `retryable` errors (timeouts, network failures, 429, 5xx) are retried by
 * the ToolRunner after 1 s, 4 s and 16 s; the others fail the call at once.
 */
export class ToolFailure extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ToolFailure';
  }

  static retryable(message: string): ToolFailure {
    return new ToolFailure('PROVIDER_ERROR', message, true);
  }
  static final(message: string): ToolFailure {
    return new ToolFailure('PROVIDER_ERROR', message, false);
  }
  static notConfigured(message: string): ToolFailure {
    return new ToolFailure('PROVIDER_NOT_CONFIGURED', message, false);
  }
}

/** What an adapter returns: normalised output and the units it used. */
export interface AdapterResult<O> {
  readonly output: O;
  readonly units: number;
  /**
   * Units metered on companion Tools (Claude output tokens on `claude.<role>.out`). Each is
   * recorded as its own Tool call row.
   */
  readonly meters?: readonly { readonly toolKey: string; readonly units: number }[];
}

/** An adapter with its types erased so a registry can hold them all. */
export interface RegisteredAdapter {
  readonly key: string;
  readonly requires: ProviderRequirement;
  parseInput(raw: unknown): { ok: true; value: unknown } | { ok: false; message: string };
  parseOutput(raw: unknown): { ok: true; value: unknown } | { ok: false; message: string };
  maxUnits(input: unknown): number;
  maxMeters(input: unknown): readonly { readonly toolKey: string; readonly units: number }[];
  run(input: unknown): Promise<AdapterResult<unknown>>;
}

export type AdapterRegistry = ReadonlyMap<string, RegisteredAdapter>;

export function adapterRegistry(adapters: readonly RegisteredAdapter[]): AdapterRegistry {
  return new Map(adapters.map((a) => [a.key, a]));
}
