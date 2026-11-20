import { ValidationError } from '../../../shared/domain/errors.js';

export const MILLICREDITS_PER_CREDIT = 1000;

/** ADR 0009: fractional Tool prices accumulate per run and round up once, at Settlement. */
export function creditsFromMillicredits(millicredits: number): number {
  if (!Number.isSafeInteger(millicredits) || millicredits < 0) {
    throw new ValidationError('Millicredits must be a non-negative whole number', {
      millicredits: String(millicredits),
    });
  }
  return Math.ceil(millicredits / MILLICREDITS_PER_CREDIT);
}

export type RunOutcome = 'completed' | 'failed' | 'cancelled';

/**
 * FR-20 failure policy: a failed run that delivered no Leads is free (Viper absorbs the provider
 * cost); otherwise the real cost is charged, rounded up to whole credits.
 */
export function chargeableCredits(props: {
  millicreditsSpent: number;
  outcome: RunOutcome;
  leadsDelivered: number;
}): number {
  const realCost = creditsFromMillicredits(props.millicreditsSpent);
  if (props.outcome === 'failed' && props.leadsDelivered === 0) return 0;
  return realCost;
}
