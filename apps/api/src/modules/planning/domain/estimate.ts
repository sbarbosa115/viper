/** Share of max credits shown as "usually" when the flow has too few comparable runs (FR-17). */
export const FALLBACK_TYPICAL_SHARE = 0.6;

export interface Estimate {
  readonly maxCredits: number;
  readonly typicalCredits: number;
}

/**
 * FR-17: "Up to <maxCredits> credits · usually <typical>". `flowTypical` is the median credits of
 * the last 20 completed runs of the same flow with at least one Lead, or null when there are fewer
 * than 5 such runs; then typical is 60% of max credits. Typical never exceeds max credits, since a
 * run can't spend more than its Plan allows.
 */
export function estimate(maxCredits: number, flowTypical: number | null): Estimate {
  const typical =
    flowTypical === null
      ? Math.round(maxCredits * FALLBACK_TYPICAL_SHARE)
      : Math.round(flowTypical);
  return { maxCredits, typicalCredits: Math.max(0, Math.min(maxCredits, typical)) };
}
