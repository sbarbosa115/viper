export const LOW_MARGIN_PCT = 60;

/** $ per unit from microdollars: 32000 → "$0.0320". */
export const formatUnitCost = (micros: number): string => `$${(micros / 1_000_000).toFixed(4)}`;

/** 1 − provider cost ÷ (credits × $0.01); null when the Tool is not charged. */
export function marginPct(creditsPerUnit: number, micros: number): number | null {
  if (!(creditsPerUnit > 0)) return null;
  return (1 - micros / 1_000_000 / (creditsPerUnit * 0.01)) * 100;
}

export const isLowMargin = (margin: number | null): boolean =>
  margin !== null && Math.round(margin) < LOW_MARGIN_PCT;

/** "412 · 0.2%", or "0 · —" with no calls. */
export function formatHealth(calls: number, errorRate: number | null): string {
  const rate = errorRate === null ? '—' : `${Math.round(errorRate * 10) / 10}%`;
  return `${new Intl.NumberFormat('en-US').format(calls)} · ${rate}`;
}

/** The text of a decimal with up to 3 places: 8 → "8", 1.5 → "1.5". */
export const formatCreditsPerUnit = (n: number): string => String(Math.round(n * 1000) / 1000);
