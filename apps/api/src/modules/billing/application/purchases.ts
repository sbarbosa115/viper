import type { AnalyticsTracker } from '../../../shared/application/analytics-tracker.js';
import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import { CodedError, NotFoundError } from '../../../shared/domain/errors.js';
import { ledgerEntry, packDescription, purchaseKey } from '../domain/ledger-entry.js';
import { Purchase } from '../domain/purchase.js';
import { requireBuyer } from './policies.js';
import type { BillingUnitOfWork, PaymentGateway } from './ports.js';

/** FR-12: "Buy" on a pack creates a Stripe Checkout Session and a pending Purchase. */
export class StartCheckout {
  constructor(
    private readonly deps: {
      uow: BillingUnitOfWork;
      clock: Clock;
      ids: IdGenerator;
      gateway: PaymentGateway;
      /** e.g. https://app.example.com, without a trailing slash. */
      appUrl: string;
    },
  ) {}

  async execute(cmd: { packId: string }, actor: Actor): Promise<{ checkoutUrl: string }> {
    requireBuyer(actor);
    if (!(await this.deps.gateway.isAvailable())) {
      throw new CodedError('PAYMENTS_UNAVAILABLE', "Payments aren't set up yet");
    }
    const pack = await this.deps.uow.run(({ packs }) => packs.findById(cmd.packId));
    if (!pack?.active) throw new NotFoundError('Credit pack not found', { packId: cmd.packId });

    const base = this.deps.appUrl.replace(/\/+$/, '');
    const session = await this.deps.gateway.createCheckoutSession({
      businessId: actor.businessId,
      packId: pack.id,
      packName: pack.name,
      credits: pack.credits,
      amountCents: pack.priceCents,
      successUrl: `${base}/app/credits?purchase=success`,
      cancelUrl: `${base}/app/credits`,
    });
    await this.deps.uow.run(({ purchases }) =>
      purchases.save(
        Purchase.start({
          id: this.deps.ids.next(),
          businessId: actor.businessId,
          packId: pack.id,
          credits: pack.credits,
          amountCents: pack.priceCents,
          stripeSessionId: session.sessionId,
          now: this.deps.clock.now(),
        }),
      ),
    );
    return { checkoutUrl: session.url };
  }
}

/**
 * FR-12: adds a paid pack's credits once, keyed by the Checkout Session (and Stripe event):
 * a repeated webhook, or the e2e test hook after it, changes nothing. Publishes
 * CreditPackPurchased and records `credit_pack_purchased`.
 */
export class FulfilPurchase {
  constructor(
    private readonly deps: {
      uow: BillingUnitOfWork;
      clock: Clock;
      ids: IdGenerator;
      analytics: AnalyticsTracker;
    },
  ) {}

  async execute(cmd: {
    sessionId: string;
    eventId: string;
    taxCents: number;
    paymentIntentId?: string | null;
  }): Promise<{ fulfilled: boolean }> {
    const paid = await this.deps.uow.run(async ({ purchases, packs, wallets, ledger, events }) => {
      const purchase = await purchases.findBySessionIdForUpdate(cmd.sessionId);
      if (!purchase) return null;
      const now = this.deps.clock.now();
      const marked = purchase.markPaid({
        eventId: cmd.eventId,
        taxCents: cmd.taxCents,
        now,
        paymentIntentId: cmd.paymentIntentId ?? null,
      });
      if (!marked) return null;
      await purchases.save(purchase);

      const pack = await packs.findById(purchase.packId);
      await wallets.lock(purchase.businessId);
      const inserted = await ledger.append(
        ledgerEntry({
          id: this.deps.ids.next(),
          businessId: purchase.businessId,
          type: 'purchase',
          credits: purchase.credits,
          description: packDescription(pack?.name ?? 'Credit'),
          purchaseId: purchase.id,
          idempotencyKey: purchaseKey(cmd.sessionId),
          createdAt: now,
        }),
      );
      if (!inserted) return null;
      const event = {
        purchaseId: purchase.id,
        businessId: purchase.businessId,
        packId: purchase.packId,
        credits: purchase.credits,
        amountCents: purchase.amountCents,
      };
      await events.publish('CreditPackPurchased', event);
      return event;
    });
    if (!paid) return { fulfilled: false };

    await this.deps.analytics.track({
      name: 'credit_pack_purchased',
      properties: {
        business_id: paid.businessId,
        pack_id: paid.packId,
        credits: paid.credits,
        amount_cents: paid.amountCents,
      },
    });
    return { fulfilled: true };
  }
}

/**
 * FR-12: a delayed payment failed (`checkout.session.async_payment_failed`): the pending purchase
 * is marked failed and no credits are added. A paid purchase is left as it is.
 */
export class FailPurchase {
  constructor(private readonly deps: { uow: BillingUnitOfWork }) {}

  execute(cmd: { sessionId: string }): Promise<{ failed: boolean }> {
    return this.deps.uow.run(async ({ purchases }) => {
      const purchase = await purchases.findBySessionIdForUpdate(cmd.sessionId);
      if (!purchase?.markFailed()) return { failed: false };
      await purchases.save(purchase);
      return { failed: true };
    });
  }
}

/**
 * FR-7: `charge.refunded` adds a refund row for the increase of the Purchase's cumulative refunded
 * amount (and updates that amount and time). Found by the
 * payment intent stored when it was paid; unknown intents change nothing. Credits stay.
 */
export class RecordRefund {
  constructor(private readonly deps: { uow: BillingUnitOfWork; ids: IdGenerator }) {}

  execute(cmd: {
    eventId: string;
    paymentIntentId: string;
    refundedCents: number;
    occurredAt: Date;
  }): Promise<{ found: boolean }> {
    return this.deps.uow.run(async ({ purchases }) => {
      const purchase = await purchases.findByPaymentIntentIdForUpdate(cmd.paymentIntentId);
      if (!purchase) return { found: false };
      const deltaCents = purchase.recordRefund({
        refundedCents: cmd.refundedCents,
        now: cmd.occurredAt,
      });
      if (deltaCents > 0) {
        const added = await purchases.addRefund({
          id: this.deps.ids.next(),
          purchaseId: purchase.id,
          stripeEventId: cmd.eventId,
          deltaCents,
          refundedAt: cmd.occurredAt,
        });
        if (added) await purchases.save(purchase);
      }
      return { found: true };
    });
  }
}

/**
 * POST /api/webhooks/stripe: verify the raw body, then act on the Checkout Session events.
 * `completed` fulfils when already paid (cards); a method that settles later completes unpaid and
 * is fulfilled by `async_payment_succeeded` or failed by `async_payment_failed`. Fulfilment is
 * idempotent by session, so any repeat or overlap adds credits once.
 */
export class HandleStripeWebhook {
  constructor(
    private readonly deps: {
      gateway: PaymentGateway;
      fulfilPurchase: FulfilPurchase;
      failPurchase: FailPurchase;
      recordRefund: RecordRefund;
    },
  ) {}

  /** `unknownPaymentIntent` is set when a refund matched no Purchase (the caller logs it). */
  async execute(cmd: {
    rawBody: Buffer;
    signature: string | undefined;
  }): Promise<{ unknownPaymentIntent?: string }> {
    const event = await this.deps.gateway.verifyWebhook(cmd.rawBody, cmd.signature);
    if (event.type === 'other') return {};
    if (event.type === 'charge.refunded') {
      const { found } = await this.deps.recordRefund.execute({
        eventId: event.id,
        paymentIntentId: event.paymentIntentId,
        refundedCents: event.amountRefundedCents,
        occurredAt: event.occurredAt,
      });
      return found ? {} : { unknownPaymentIntent: event.paymentIntentId };
    }
    if (event.type === 'checkout.session.async_payment_failed') {
      await this.deps.failPurchase.execute({ sessionId: event.sessionId });
      return {};
    }
    if (!event.paid) return {};
    await this.deps.fulfilPurchase.execute({
      sessionId: event.sessionId,
      eventId: event.id,
      taxCents: event.taxCents,
      paymentIntentId: event.paymentIntentId,
    });
    return {};
  }
}
