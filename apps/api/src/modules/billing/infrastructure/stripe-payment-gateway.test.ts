import Stripe from 'stripe';
import { describe, expect, test } from 'vitest';
import { CodedError } from '../../../shared/domain/errors.js';
import type { StripeSettings } from '../application/ports.js';
import { StripePaymentGateway } from './stripe-payment-gateway.js';

const WEBHOOK_SECRET = 'whsec_test_secret';

function settings(
  overrides: Partial<Awaited<ReturnType<StripeSettings['stripe']>>> = {},
): StripeSettings {
  return {
    stripe: () =>
      Promise.resolve({
        secretKey: 'sk_test_123',
        webhookSecret: WEBHOOK_SECRET,
        taxEnabled: true,
        ...overrides,
      }),
  };
}

/** A Stripe client whose HTTP calls are captured and answered locally (never the network). */
function capturingClient() {
  const requests: { url: string; body: string }[] = [];
  const fetchFn = (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    requests.push({ url: href, body: typeof init?.body === 'string' ? init.body : '' });
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'cs_test_1',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_test_1',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  };
  const factory = (key: string) =>
    new Stripe(key, { httpClient: Stripe.createFetchHttpClient(fetchFn), maxNetworkRetries: 0 });
  return { requests, factory };
}

describe('FR-12: Stripe adapter', () => {
  test('is available only with a secret key and a webhook secret', async () => {
    expect(await new StripePaymentGateway(settings()).isAvailable()).toBe(true);
    expect(await new StripePaymentGateway(settings({ secretKey: null })).isAvailable()).toBe(false);
    expect(await new StripePaymentGateway(settings({ webhookSecret: null })).isAvailable()).toBe(
      false,
    );
  });

  test('creates a payment-mode Checkout Session with the business, pack and automatic tax', async () => {
    const { requests, factory } = capturingClient();
    const gateway = new StripePaymentGateway(settings(), factory);

    const session = await gateway.createCheckoutSession({
      businessId: 'b-1',
      packId: 'p-1',
      packName: 'Starter',
      credits: 2500,
      amountCents: 2500,
      successUrl: 'https://app.test/app/credits?purchase=success',
      cancelUrl: 'https://app.test/app/credits',
    });

    expect(session).toEqual({
      sessionId: 'cs_test_1',
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
    });
    expect(requests[0]?.url).toContain('/v1/checkout/sessions');
    const form = new URLSearchParams(requests[0]?.body);
    expect(Object.fromEntries(form)).toMatchObject({
      mode: 'payment',
      // Cards settle at once; delayed methods are off (their async events are handled anyway).
      'allowed_payment_method_types[0]': 'card',
      client_reference_id: 'b-1',
      'metadata[packId]': 'p-1',
      'line_items[0][price_data][unit_amount]': '2500',
      'line_items[0][price_data][currency]': 'usd',
      'automatic_tax[enabled]': 'true',
      success_url: 'https://app.test/app/credits?purchase=success',
      cancel_url: 'https://app.test/app/credits',
    });
  });

  test('leaves automatic tax off when Stripe Tax is off', async () => {
    const { requests, factory } = capturingClient();
    await new StripePaymentGateway(settings({ taxEnabled: false }), factory).createCheckoutSession({
      businessId: 'b',
      packId: 'p',
      packName: 'Pro',
      credits: 1,
      amountCents: 50,
      successUrl: 'https://a.test/s',
      cancelUrl: 'https://a.test/c',
    });
    expect(new URLSearchParams(requests[0]?.body).has('automatic_tax[enabled]')).toBe(false);
  });

  test('verifies a signed checkout.session.completed event from the raw body', async () => {
    const payload = JSON.stringify({
      id: 'evt_1',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: { id: 'cs_test_1', payment_status: 'paid', total_details: { amount_tax: 180 } },
      },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

    expect(
      await new StripePaymentGateway(settings()).verifyWebhook(Buffer.from(payload), header),
    ).toEqual({
      id: 'evt_1',
      type: 'checkout.session.completed',
      sessionId: 'cs_test_1',
      paid: true,
      taxCents: 180,
    });
  });

  test('rejects a bad signature, a missing one, or no webhook secret with INVALID_SIGNATURE', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
    const forged = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_other' });
    const cases: [StripeSettings, string | undefined][] = [
      [settings(), forged],
      [settings(), undefined],
      [settings({ webhookSecret: null }), forged],
    ];
    for (const [s, header] of cases) {
      await expect(
        new StripePaymentGateway(s).verifyWebhook(Buffer.from(payload), header),
      ).rejects.toSatisfy((e) => e instanceof CodedError && e.code === 'INVALID_SIGNATURE');
    }
  });
});
