export interface PurchaseSnapshot {
  id: string;
  businessId: string;
  packId: string;
  /** The pack's credits at purchase time. */
  credits: number;
  stripeSessionId: string;
  stripeEventId: string | null;
  amountCents: number;
  taxCents: number;
  status: 'pending' | 'paid';
  createdAt: Date;
  paidAt: Date | null;
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
      amountCents: props.amountCents,
      taxCents: 0,
      status: 'pending',
      createdAt: props.now,
      paidAt: null,
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
  get isPaid(): boolean {
    return this.s.status === 'paid';
  }

  /** Returns false when already paid, so a repeated webhook changes nothing. */
  markPaid(props: { eventId: string; taxCents: number; now: Date }): boolean {
    if (this.isPaid) return false;
    this.s = {
      ...this.s,
      status: 'paid',
      stripeEventId: props.eventId,
      taxCents: Math.max(0, props.taxCents),
      paidAt: props.now,
    };
    return true;
  }

  toSnapshot(): PurchaseSnapshot {
    return { ...this.s };
  }
}
