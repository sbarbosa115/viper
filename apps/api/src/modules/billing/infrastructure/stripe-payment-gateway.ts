import Stripe from 'stripe';
import { CodedError } from '../../../shared/domain/errors.js';
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentEvent,
  PaymentGateway,
  StripeSettings,
} from '../application/ports.js';
import { parseEvent } from './stripe-event.js';

type StripeClientFactory = (secretKey: string) => Stripe;

const defaultFactory: StripeClientFactory = (secretKey) =>
  new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 20_000 });

/**
 * Stripe Checkout (mode `payment`) and webhook verification (FR-12). Keys come from Platform
 * settings on every call, so a key saved by Staff applies without a restart.
 */
export class StripePaymentGateway implements PaymentGateway {
  private client: { key: string; stripe: Stripe } | null = null;

  constructor(
    private readonly settings: StripeSettings,
    private readonly createClient: StripeClientFactory = defaultFactory,
  ) {}

  async isAvailable(): Promise<boolean> {
    const s = await this.settings.stripe();
    return Boolean(s.secretKey && s.webhookSecret);
  }

  async createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
    const settings = await this.settings.stripe();
    if (!settings.secretKey || !settings.webhookSecret) {
      throw new CodedError('PAYMENTS_UNAVAILABLE', "Payments aren't set up yet");
    }
    const session = await this.stripe(settings.secretKey).checkout.sessions.create({
      mode: 'payment',
      // Cards only: they settle at once. (This SDK's API version replaced `payment_method_types`
      // with this filter.) Methods that settle days later are off; if one is ever allowed, the
      // async_payment_succeeded / _failed webhooks fulfil or fail the purchase.
      allowed_payment_method_types: ['card'],
      client_reference_id: request.businessId,
      metadata: { packId: request.packId, businessId: request.businessId },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: request.amountCents,
            product_data: {
              name: `${request.packName} pack`,
              description: `${request.credits.toLocaleString('en-US')} credits`,
            },
            ...(settings.taxEnabled ? { tax_behavior: 'exclusive' as const } : {}),
          },
        },
      ],
      ...(settings.taxEnabled ? { automatic_tax: { enabled: true } } : {}),
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
    });
    if (!session.url) throw new Error('Stripe returned a Checkout Session without a URL');
    return { sessionId: session.id, url: session.url };
  }

  async verifyWebhook(rawBody: Buffer, signature: string | undefined): Promise<PaymentEvent> {
    const settings = await this.settings.stripe();
    if (!settings.webhookSecret || !signature) {
      throw new CodedError('INVALID_SIGNATURE', 'Invalid webhook signature');
    }
    let event: Stripe.Event;
    try {
      event = Stripe.webhooks.constructEvent(rawBody, signature, settings.webhookSecret);
    } catch {
      throw new CodedError('INVALID_SIGNATURE', 'Invalid webhook signature');
    }
    return parseEvent(event as unknown as Parameters<typeof parseEvent>[0]);
  }

  private stripe(secretKey: string): Stripe {
    if (this.client?.key !== secretKey) {
      this.client = { key: secretKey, stripe: this.createClient(secretKey) };
    }
    return this.client.stripe;
  }
}
