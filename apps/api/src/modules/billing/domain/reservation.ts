import { DomainRuleViolation, ValidationError } from '../../../shared/domain/errors.js';
import { assertWholeCredits } from './wallet.js';

export type ReservationStatus = 'open' | 'settled' | 'released';

export interface ReservationSnapshot {
  runId: string;
  businessId: string;
  credits: number;
  status: ReservationStatus;
  createdAt: Date;
  closedAt: Date | null;
}

export interface SettlementResult {
  /** Credits charged by this Settlement (a Settlement Ledger entry when > 0). */
  charged: number;
  /** Credits of the hold given back to available. */
  released: number;
}

function assertPositive(credits: number): void {
  assertWholeCredits(credits);
  if (credits <= 0) throw new ValidationError('Reserve at least 1 credit', { credits: 'min 1' });
}

/**
 * Credits held for one Research run (ADR 0009). One Reservation covers all of a run's attempts
 * (FR-36); a resume after Settlement reopens it with a new hold for the remaining budget.
 */
export class Reservation {
  private constructor(private s: ReservationSnapshot) {}

  static open(props: {
    runId: string;
    businessId: string;
    credits: number;
    now: Date;
  }): Reservation {
    assertPositive(props.credits);
    return new Reservation({
      runId: props.runId,
      businessId: props.businessId,
      credits: props.credits,
      status: 'open',
      createdAt: props.now,
      closedAt: null,
    });
  }

  static restore(s: ReservationSnapshot): Reservation {
    return new Reservation({ ...s });
  }

  get runId(): string {
    return this.s.runId;
  }
  get businessId(): string {
    return this.s.businessId;
  }
  get credits(): number {
    return this.s.credits;
  }
  get status(): ReservationStatus {
    return this.s.status;
  }
  get isOpen(): boolean {
    return this.s.status === 'open';
  }

  /** Holds more credits: extends an open hold, or reopens a closed one (resume, FR-32/FR-36). */
  topUp(credits: number): void {
    assertPositive(credits);
    this.s = this.isOpen
      ? { ...this.s, credits: this.s.credits + credits }
      : { ...this.s, credits, status: 'open', closedAt: null };
  }

  /** Charges up to the hold and releases the rest (FR-20). */
  settle(credits: number, now: Date): SettlementResult {
    this.assertOpen();
    assertWholeCredits(credits);
    const charged = Math.min(Math.max(credits, 0), this.s.credits);
    this.s = { ...this.s, status: 'settled', closedAt: now };
    return { charged, released: this.s.credits - charged };
  }

  /** Gives the whole hold back without charging. */
  release(now: Date): SettlementResult {
    this.assertOpen();
    this.s = { ...this.s, status: 'released', closedAt: now };
    return { charged: 0, released: this.s.credits };
  }

  toSnapshot(): ReservationSnapshot {
    return { ...this.s };
  }

  private assertOpen(): void {
    if (!this.isOpen) throw new DomainRuleViolation('The Reservation is already closed');
  }
}
