import { ValidationError } from '../../../shared/domain/errors.js';

/** 1 credit = $0.01 at list price = 10,000 microdollars (PRD section 13). */
export const MICROS_PER_CREDIT = 10_000;
export const MAX_CREDITS_PER_UNIT = 10_000;
export const MAX_PROVIDER_COST_MICROS = 100_000_000;
/** The seeded Rate card must keep at least this margin (G-3). */
export const TARGET_MARGIN_PCT = 60;

/**
 * A Tool's price (FR-23): credits per unit with 3 decimals, and the provider's cost per unit in
 * microdollars. Credits are held as thousandths (millicredits per unit) so metering is exact.
 */
export class RateCard {
  private constructor(
    /** Credits per unit × 1000. */
    readonly millicreditsPerUnit: number,
    readonly providerCostMicrosPerUnit: number,
  ) {}

  static of(props: { creditsPerUnit: number; providerCostMicrosPerUnit: number }): RateCard {
    const milli = Math.round(props.creditsPerUnit * 1000);
    if (
      !Number.isFinite(props.creditsPerUnit) ||
      props.creditsPerUnit < 0 ||
      props.creditsPerUnit > MAX_CREDITS_PER_UNIT ||
      Math.abs(props.creditsPerUnit * 1000 - milli) > 1e-6
    ) {
      throw new ValidationError('Credits per unit must be 0 to 10,000 with at most 3 decimals', {
        creditsPerUnit: 'Use 0 to 10,000 with at most 3 decimals',
      });
    }
    const cost = props.providerCostMicrosPerUnit;
    if (!Number.isInteger(cost) || cost < 0 || cost > MAX_PROVIDER_COST_MICROS) {
      throw new ValidationError('Provider cost must be a whole number of microdollars', {
        providerCostMicrosPerUnit: 'Use a whole number from 0 to 100,000,000',
      });
    }
    return new RateCard(milli, cost);
  }

  get creditsPerUnit(): number {
    return this.millicreditsPerUnit / 1000;
  }

  /** round(units × credits per unit × 1000), exact because credits have 3 decimals. */
  millicreditsFor(units: number): number {
    return units * this.millicreditsPerUnit;
  }

  providerCostMicrosFor(units: number): number {
    return units * this.providerCostMicrosPerUnit;
  }

  /** 1 − provider cost ÷ (credits × $0.01), in %, 1 decimal; null when credits per unit is 0. */
  marginPct(): number | null {
    if (this.millicreditsPerUnit === 0) return null;
    const priceMicros = (this.millicreditsPerUnit * MICROS_PER_CREDIT) / 1000;
    return Math.round((1 - this.providerCostMicrosPerUnit / priceMicros) * 1000) / 10;
  }
}
