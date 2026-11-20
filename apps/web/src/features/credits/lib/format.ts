const number = new Intl.NumberFormat('en-US');

export const formatCredits = (n: number): string => number.format(n);

/** Signed credits with a real minus sign: +950, −137. */
export function formatSignedCredits(n: number): string {
  if (n > 0) return `+${number.format(n)}`;
  if (n < 0) return `−${number.format(Math.abs(n))}`;
  return '0';
}

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

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export const formatShortDate = (iso: string): string => dateFormat.format(new Date(iso));

/** Bonus credits over the list price of one cent per credit, as a whole percent (0 when none). */
export function bonusPercent(credits: number, cents: number): number {
  return Math.max(0, Math.round((credits / cents - 1) * 100));
}
