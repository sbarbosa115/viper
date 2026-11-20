import type { z } from 'zod';
import type { AdapterResult, RegisteredAdapter } from '../../application/tool-adapter.js';
import type { ProviderRequirement } from '../../domain/tool-keys.js';

/** One adapter per Tool (FR-24), with Zod input and output schemas. */
export interface ToolAdapter<I, O> {
  readonly key: string;
  readonly requires: ProviderRequirement;
  readonly input: z.ZodType<I>;
  readonly output: z.ZodType<O>;
  /** The most units a call with this input can use (before capping at max units per call). */
  maxUnits(input: I): number;
  /** Companion meters and their most units, for the budget check (Claude output tokens). */
  maxMeters?(input: I): readonly { readonly toolKey: string; readonly units: number }[];
  run(input: I): Promise<AdapterResult<O>>;
}

function parser<T>(schema: z.ZodType<T>) {
  return (raw: unknown): { ok: true; value: unknown } | { ok: false; message: string } => {
    const parsed = schema.safeParse(raw);
    if (parsed.success) return { ok: true, value: parsed.data };
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return { ok: false, message: `${where}${issue?.message ?? 'Invalid'}`.slice(0, 300) };
  };
}

export function registerAdapter<I, O>(adapter: ToolAdapter<I, O>): RegisteredAdapter {
  return {
    key: adapter.key,
    requires: adapter.requires,
    parseInput: parser(adapter.input),
    parseOutput: parser(adapter.output),
    // The runner passes only values that parseInput produced, so the casts hold.
    maxUnits: (input) => adapter.maxUnits(input as I),
    maxMeters: (input) => adapter.maxMeters?.(input as I) ?? [],
    run: (input) => adapter.run(input as I),
  };
}
