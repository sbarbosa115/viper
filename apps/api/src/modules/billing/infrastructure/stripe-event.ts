import { CodedError } from '../../../shared/domain/errors.js';
import type { PaymentEvent } from '../application/ports.js';

interface StripeLikeEvent {
  id?: unknown;
  type?: unknown;
  data?: {
    object?: { id?: unknown; payment_status?: unknown; total_details?: { amount_tax?: unknown } };
  };
}

/**
 * The Checkout Session events billing acts on: `completed` (paid now, or pending for a method
 * that settles later), then `async_payment_succeeded` or `async_payment_failed` for those.
 */
const SESSION_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
] as const;

/** Reduces a Stripe event (already verified) to what fulfilment needs. */
export function parseEvent(rawBody: Buffer | StripeLikeEvent): PaymentEvent {
  let event: StripeLikeEvent;
  try {
    event = Buffer.isBuffer(rawBody)
      ? (JSON.parse(rawBody.toString('utf8')) as StripeLikeEvent)
      : rawBody;
  } catch {
    throw new CodedError('INVALID_SIGNATURE', 'Webhook body is not JSON');
  }
  const id = typeof event.id === 'string' ? event.id : '';
  const session = event.data?.object;
  const type = SESSION_EVENTS.find((t) => t === event.type);
  if (!type || typeof session?.id !== 'string') return { id, type: 'other' };
  const tax = session.total_details?.amount_tax;
  return {
    id,
    type,
    sessionId: session.id,
    paid: session.payment_status === 'paid' || session.payment_status === 'no_payment_required',
    taxCents: typeof tax === 'number' ? tax : 0,
  };
}
