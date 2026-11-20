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
  }): Promise<{ fulfilled: boolean }> {
    const paid = await this.deps.uow.run(async ({ purchases, packs, wallets, ledger, events }) => {
      const purchase = await purchases.findBySessionIdForUpdate(cmd.sessionId);
      if (!purchase) return null;
      const now = this.deps.clock.now();
      if (!purchase.markPaid({ eventId: cmd.eventId, taxCents: cmd.taxCents, now })) return null;
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

/** POST /api/webhooks/stripe: verify the raw body, then fulfil `checkout.session.completed`. */
export class HandleStripeWebhook {
  constructor(private readonly deps: { gateway: PaymentGateway; fulfilPurchase: FulfilPurchase }) {}

  async execute(cmd: { rawBody: Buffer; signature: string | undefined }): Promise<void> {
    const event = await this.deps.gateway.verifyWebhook(cmd.rawBody, cmd.signature);
    if (event.type !== 'checkout.session.completed' || !event.paid) return;
    await this.deps.fulfilPurchase.execute({
      sessionId: event.sessionId,
      eventId: event.id,
      taxCents: event.taxCents,
    });
  }
}
