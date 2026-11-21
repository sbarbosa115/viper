export interface PurchaseSnapshot {
  id: string;
  businessId: string;
  packId: string;
  /** The pack's credits at purchase time. */
  credits: number;
  stripeSessionId: string;
  stripeEventId: string | null;
  /** The Checkout Session's payment intent, stored when paid; null before the release that added it. */
  stripePaymentIntentId: string | null;
  amountCents: number;
  taxCents: number;
  /** The charge's cumulative refunded amount, tax included (Stripe `amount_refunded`). */
  refundedCents: number;
  status: 'pending' | 'paid' | 'failed';
  createdAt: Date;
  paidAt: Date | null;
  refundedAt: Date | null;
}

/** A Credit pack bought through Stripe Checkout; paid only by the webhook (FR-12). */
export class Purchase {
  private constructor(private s: PurchaseSnapshot) {}

  static start(props: {
    id: string;
    businessId: string;
    packId: string;
    credits: number;
    amountCents: number;
    stripeSessionId: string;
    now: Date;
  }): Purchase {
    return new Purchase({
      id: props.id,
      businessId: props.businessId,
      packId: props.packId,
      credits: props.credits,
      stripeSessionId: props.stripeSessionId,
      stripeEventId: null,
      stripePaymentIntentId: null,
      amountCents: props.amountCents,
      taxCents: 0,
      refundedCents: 0,
      status: 'pending',
      createdAt: props.now,
      paidAt: null,
      refundedAt: null,
    });
  }

  static restore(s: PurchaseSnapshot): Purchase {
    return new Purchase({ ...s });
  }

  get id(): string {
    return this.s.id;
  }
  get businessId(): string {
    return this.s.businessId;
  }
  get packId(): string {
    return this.s.packId;
  }
  get credits(): number {
    return this.s.credits;
  }
  get amountCents(): number {
    return this.s.amountCents;
  }
  get refundedCents(): number {
    return this.s.refundedCents;
  }
  get isPaid(): boolean {
    return this.s.status === 'paid';
  }

  get status(): PurchaseSnapshot['status'] {
    return this.s.status;
  }

  /**
   * A delayed payment failed (Stripe `checkout.session.async_payment_failed`). Only a pending
   * purchase fails; returns false otherwise (a paid one stays paid).
   */
  markFailed(): boolean {
    if (this.s.status !== 'pending') return false;
    this.s = { ...this.s, status: 'failed' };
    return true;
  }

  /** Returns false when already paid, so a repeated webhook changes nothing. */
  markPaid(props: {
    eventId: string;
    taxCents: number;
    now: Date;
    paymentIntentId?: string | null;
  }): boolean {
    if (this.isPaid) return false;
    this.s = {
      ...this.s,
      status: 'paid',
      stripeEventId: props.eventId,
      taxCents: Math.max(0, props.taxCents),
      stripePaymentIntentId: props.paymentIntentId ?? null,
      paidAt: props.now,
    };
    return true;
  }

  /**
   * A refund from Stripe's `charge.refunded` (FR-7). `refundedCents` is the charge's cumulative
   * amount, so a repeated or older event changes nothing: it only ever grows. Credits stay.
   * Returns the increase (the refund to record as a row), 0 when nothing changed.
   */
  recordRefund(props: { refundedCents: number; now: Date }): number {
    if (!this.isPaid || props.refundedCents <= this.s.refundedCents) return 0;
    const delta = props.refundedCents - this.s.refundedCents;
    this.s = { ...this.s, refundedCents: props.refundedCents, refundedAt: props.now };
    return delta;
  }

  toSnapshot(): PurchaseSnapshot {
    return { ...this.s };
  }
}
