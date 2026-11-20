import { CodedError, ValidationError } from '../../../shared/domain/errors.js';

/** 402 (422 on the Staff grant route): not enough available credits. Details per PRD section 7. */
export function insufficientCredits(available: number, required: number): CodedError {
  return new CodedError(
    'INSUFFICIENT_CREDITS',
    `You need ${required} credits, you have ${available}`,
    { available, required },
  );
}

export function assertWholeCredits(credits: number, label = 'credits'): void {
  if (!Number.isSafeInteger(credits)) {
    throw new ValidationError('Credits are whole numbers', { [label]: 'Enter a whole number' });
  }
}

/**
 * A Business's Credit wallet totals (FR-10, ADR 0009): balance is the sum of its Ledger entries,
 * reserved the sum of its open Reservations, available = balance − reserved.
 */
export class Wallet {
  private constructor(
    readonly businessId: string,
    readonly balance: number,
    readonly reserved: number,
  ) {}

  static of(props: { businessId: string; balance: number; reserved: number }): Wallet {
    assertWholeCredits(props.balance, 'balance');
    assertWholeCredits(props.reserved, 'reserved');
    return new Wallet(props.businessId, props.balance, props.reserved);
  }

  get available(): number {
    return this.balance - this.reserved;
  }

  /** Throws INSUFFICIENT_CREDITS unless `credits` can be held or spent without going below 0. */
  assertCovers(credits: number): void {
    if (credits > this.available) throw insufficientCredits(Math.max(0, this.available), credits);
  }
}
