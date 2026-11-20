const number = new Intl.NumberFormat('en-US');

export const formatCredits = (n: number): string => number.format(n);

/** USD from cents: $25, $12.50. */
export function formatUsd(cents: number): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

/** Bonus credits over the list price of one cent per credit, as a whole percent (0 when none). */
export function bonusPercent(credits: number, cents: number): number {
  return Math.max(0, Math.round((credits / cents - 1) * 100));
}

/** Dollars typed by Staff to cents; NaN when it is not a number. */
export function dollarsToCents(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? Number.NaN : Math.round(Number(trimmed) * 100);
}

export const centsToDollars = (cents: number): string => String(cents / 100);
