import { createHmac, timingSafeEqual } from 'node:crypto';
import { CodedError } from '../../../shared/domain/errors.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentEvent,
  PaymentGateway,
} from '../application/ports.js';
import { parseEvent } from './stripe-event.js';

const FAKE_WEBHOOK_SECRET = 'whsec_fake';

/**
 * Stripe stand-in for dev, tests and e2e (AJ-3). Its Checkout URL is the app's own credits page
 * (`/app/credits?purchase=success&fake_session=<id>`); the test hook
 * `POST /api/test/stripe/complete/:sessionId` then fulfils it like the webhook would. Webhooks
 * are signed with an HMAC of the raw body (`sign()`), so signature checks are testable.
 */
export class FakePaymentGateway implements PaymentGateway {
  readonly sessions: (CheckoutRequest & { sessionId: string })[] = [];
  available = true;

  constructor(
    private readonly ids: IdGenerator,
    private readonly appUrl: string,
  ) {}

  isAvailable(): Promise<boolean> {
    return Promise.resolve(this.available);
  }

  createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
    const sessionId = `cs_fake_${this.ids.next()}`;
    this.sessions.push({ ...request, sessionId });
    const base = this.appUrl.replace(/\/+$/, '');
    return Promise.resolve({
      sessionId,
      url: `${base}/app/credits?purchase=success&fake_session=${sessionId}`,
    });
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): Promise<PaymentEvent> {
    const expected = Buffer.from(FakePaymentGateway.sign(rawBody));
    const given = Buffer.from(signature ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return Promise.reject(new CodedError('INVALID_SIGNATURE', 'Invalid webhook signature'));
    }
    return Promise.resolve(parseEvent(rawBody));
  }

  /** The `Stripe-Signature` header value the fake accepts for this body. */
  static sign(rawBody: Buffer | string): string {
    return `v1=${createHmac('sha256', FAKE_WEBHOOK_SECRET).update(rawBody).digest('hex')}`;
  }

  /**
   * A Stripe-shaped Checkout Session event body: `checkout.session.completed` (paid) by default,
   * or an async payment result for methods that settle later.
   */
  static completedEvent(props: {
    eventId: string;
    sessionId: string;
    taxCents?: number;
    type?:
      | 'checkout.session.completed'
      | 'checkout.session.async_payment_succeeded'
      | 'checkout.session.async_payment_failed';
    paymentStatus?: 'paid' | 'unpaid' | 'no_payment_required';
  }): string {
    const type = props.type ?? 'checkout.session.completed';
    const paymentStatus =
      props.paymentStatus ?? (type === 'checkout.session.async_payment_failed' ? 'unpaid' : 'paid');
    return JSON.stringify({
      id: props.eventId,
      type,
      data: {
        object: {
          id: props.sessionId,
          payment_status: paymentStatus,
          total_details: { amount_tax: props.taxCents ?? 0 },
        },
      },
    });
  }
}
