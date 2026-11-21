import {
  createCheckout,
  creditPack,
  getCredits,
  grantCredits,
  listCreditPacks,
  listLedger,
  stripeWebhook,
} from '@app/contracts/billing';
import { errorResponse, insufficientCreditsError } from '@app/contracts/errors';
import { describe, expect, test } from 'vitest';
import { buildTestApp } from '../../../../test/build-test-app.js';
import type { Actor } from '../../../shared/domain/actor.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import { createInMemoryBilling, FakePaymentGateway } from '../index.js';
import { actingAs, BUSINESS, owner, staff } from '../test/billing-fixture.js';

async function setup(options: { actor?: Actor; testHooks?: boolean } = {}) {
  const billing = createInMemoryBilling({
    clock: new FixedClock(new Date('2026-11-19T10:00:00.000Z')),
    ids: new SequentialIdGenerator(),
    testHooks: options.testHooks ?? false,
  });
  const starter = await billing.application.creditPacks.ensure({
    name: 'Starter',
    credits: 2500,
    priceCents: 2500,
    active: true,
  });
  const app = await buildTestApp({
    modules: [billing.module],
    ...(options.actor ? { actor: options.actor } : {}),
  });
  const fund = (credits: number) =>
    billing.application.adjustCredits.apply({
      businessId: BUSINESS,
      credits,
      reason: 'Beta',
      memberId: null,
    });
  return { app, billing, starter, fund };
}

const errorCode = (body: unknown) => errorResponse.parse(body).error.code;

describe('FR-10: GET /api/credits and /api/credits/ledger', () => {
  test('401 when not signed in', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/credits' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/credits/ledger' })).statusCode).toBe(401);
  });

  test('returns balance, reserved, available, packs and paymentsAvailable', async () => {
    const { app, billing, fund } = await setup({ actor: owner() });
    await fund(1000);
    await billing.billingCommands.reserve({
      businessId: BUSINESS,
      runId: '00000000-0000-7000-8000-0000000000a1',
      credits: 400,
    });

    const res = await app.inject({ method: 'GET', url: '/api/credits' });
    expect(res.statusCode).toBe(200);
    expect(getCredits.response.parse(res.json())).toEqual({
      balance: 1000,
      reserved: 400,
      available: 600,
      packs: [
        {
          id: expect.any(String),
          name: 'Starter',
          credits: 2500,
          price: { cents: 2500, currency: 'usd' },
        },
      ],
      paymentsAvailable: true,
    });
  });

  test('the ledger pages with limit and cursor', async () => {
    const { app, billing, fund } = await setup({ actor: owner() });
    await fund(1);
    billing.store.state.ledger[0] = {
      ...billing.store.state.ledger[0]!,
      createdAt: new Date('2026-11-18T10:00:00.000Z'),
    };
    await fund(2);

    const first = await app.inject({ method: 'GET', url: '/api/credits/ledger?limit=1' });
    const page1 = listLedger.response.parse(first.json());
    expect(page1.items.map((e) => e.credits)).toEqual([2]);
    expect(page1.items[0]).toMatchObject({ type: 'adjustment', description: 'Beta', runId: null });

    const second = await app.inject({
      method: 'GET',
      url: `/api/credits/ledger?limit=1&cursor=${page1.nextCursor ?? ''}`,
    });
    const page2 = listLedger.response.parse(second.json());
    expect(page2.items.map((e) => e.credits)).toEqual([1]);
    expect(page2.nextCursor).toBeNull();
  });

  test('400 for a limit above 100', async () => {
    const { app } = await setup({ actor: owner() });
    const res = await app.inject({ method: 'GET', url: '/api/credits/ledger?limit=101' });
    expect(res.statusCode).toBe(400);
  });
});

describe('FR-12: POST /api/credits/checkout', () => {
  test('a verified Owner gets the Checkout URL', async () => {
    const { app, starter } = await setup({ actor: owner() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/credits/checkout',
      payload: { packId: starter.id },
    });
    expect(res.statusCode).toBe(200);
    expect(createCheckout.response.parse(res.json()).checkoutUrl).toMatch(
      /^http:\/\/localhost:5173\/app\/credits\?purchase=success&fake_session=cs_fake_/,
    );
  });

  test.each([
    ['Acting as', actingAs(), 403, 'ACTING_AS_FORBIDDEN'],
    ['unverified', owner({ emailVerified: false }), 403, 'EMAIL_NOT_VERIFIED'],
  ])('%s → %i %s', async (_label, actor, status, code) => {
    const { app, starter } = await setup({ actor });
    const res = await app.inject({
      method: 'POST',
      url: '/api/credits/checkout',
      payload: { packId: starter.id },
    });
    expect(res.statusCode).toBe(status);
    expect(errorCode(res.json())).toBe(code);
  });

  test('503 PAYMENTS_UNAVAILABLE when Stripe is not configured', async () => {
    const { app, billing, starter } = await setup({ actor: owner() });
    billing.gateway.available = false;
    const res = await app.inject({
      method: 'POST',
      url: '/api/credits/checkout',
      payload: { packId: starter.id },
    });
    expect(res.statusCode).toBe(503);
    expect(errorCode(res.json())).toBe('PAYMENTS_UNAVAILABLE');
  });

  test('404 for an unknown pack, 400 for a malformed id', async () => {
    const { app } = await setup({ actor: owner() });
    const missing = await app.inject({
      method: 'POST',
      url: '/api/credits/checkout',
      payload: { packId: '00000000-0000-7000-8000-0000000fffff' },
    });
    expect(missing.statusCode).toBe(404);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/credits/checkout',
      payload: { packId: 'x' },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('FR-12: POST /api/webhooks/stripe', () => {
  async function checkedOut() {
    const s = await setup({ actor: owner() });
    await s.app.inject({
      method: 'POST',
      url: '/api/credits/checkout',
      payload: { packId: s.starter.id },
    });
    const sessionId = s.billing.gateway.sessions[0]?.sessionId ?? '';
    return { ...s, sessionId };
  }

  test('a completed checkout delivered 3 times adds the pack once', async () => {
    const { app, billing, sessionId } = await checkedOut();
    const body = FakePaymentGateway.completedEvent({ eventId: 'evt_1', sessionId });

    for (let i = 0; i < 3; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/stripe',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'stripe-signature': FakePaymentGateway.sign(body),
        },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      expect(stripeWebhook.response.parse(res.json())).toEqual({ received: true });
    }
    expect((await billing.billingQueries.getWallet(BUSINESS)).available).toBe(2500);
    expect(billing.store.state.ledger.filter((e) => e.type === 'purchase')).toHaveLength(1);
  });

  test('400 INVALID_SIGNATURE for a bad or missing signature, nothing written', async () => {
    const { app, billing, sessionId } = await checkedOut();
    const body = FakePaymentGateway.completedEvent({ eventId: 'evt_1', sessionId });
    for (const headers of [{ 'stripe-signature': 'v1=forged' }, {}]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/stripe',
        headers: { 'content-type': 'application/json', ...headers },
        payload: body,
      });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res.json())).toBe('INVALID_SIGNATURE');
    }
    expect(billing.store.state.ledger).toHaveLength(0);
  });

  test('is public (no sign-in needed)', async () => {
    const { app, billing, sessionId } = await checkedOut();
    const anonymous = await buildTestApp({ modules: [billing.module] });
    const body = FakePaymentGateway.completedEvent({ eventId: 'evt_1', sessionId });
    const res = await anonymous.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': FakePaymentGateway.sign(body),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('FR-7: charge.refunded on POST /api/webhooks/stripe', () => {
  const PI = 'pi_123';
  const refundAt = new Date('2026-12-03T09:00:00.000Z');

  async function paidPurchase() {
    const s = await setup({ actor: owner() });
    await s.app.inject({
      method: 'POST',
      url: '/api/credits/checkout',
      payload: { packId: s.starter.id },
    });
    const sessionId = s.billing.gateway.sessions[0]?.sessionId ?? '';
    const post = (body: string) =>
      s.app.inject({
        method: 'POST',
        url: '/api/webhooks/stripe',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': FakePaymentGateway.sign(body),
        },
        payload: body,
      });
    const paid = await post(
      FakePaymentGateway.completedEvent({
        eventId: 'evt_paid',
        sessionId,
        taxCents: 100,
        paymentIntentId: PI,
      }),
    );
    expect(paid.statusCode).toBe(200);
    const refund = (eventId: string, cents: number, at = refundAt) =>
      post(
        FakePaymentGateway.refundedEvent({
          eventId,
          paymentIntentId: PI,
          amountRefundedCents: cents,
          createdAt: at,
        }),
      );
    const purchase = () => s.billing.store.state.purchases[0];
    return { ...s, refund, purchase, post };
  }

  test('the payment intent is stored when the purchase is paid', async () => {
    const { purchase } = await paidPurchase();
    expect(purchase()).toMatchObject({
      status: 'paid',
      stripePaymentIntentId: PI,
      refundedCents: 0,
      refundedAt: null,
    });
  });

  test('a full refund sets refunded_cents and the event time; credits stay', async () => {
    const { refund, purchase, billing } = await paidPurchase();
    const res = await refund('evt_r1', 2_600);
    expect(res.statusCode).toBe(200);
    expect(stripeWebhook.response.parse(res.json())).toEqual({ received: true });
    expect(purchase()).toMatchObject({ refundedCents: 2_600, refundedAt: refundAt });
    expect((await billing.billingQueries.getWallet(BUSINESS)).available).toBe(2500);
  });

  test('a partial then a full refund accumulate; an older event never lowers it', async () => {
    const { refund, purchase } = await paidPurchase();
    await refund('evt_r1', 1_000);
    const second = new Date('2026-12-05T09:00:00.000Z');
    await refund('evt_r2', 2_600, second);
    expect(purchase()).toMatchObject({ refundedCents: 2_600, refundedAt: second });
    await refund('evt_r1_again', 1_000, new Date('2026-12-06T09:00:00.000Z'));
    expect(purchase()).toMatchObject({ refundedCents: 2_600, refundedAt: second });
  });

  test('AC: the same event delivered twice leaves refunded_cents and the time unchanged', async () => {
    const { refund, purchase } = await paidPurchase();
    await refund('evt_r1', 2_600);
    const first = structuredClone(purchase());
    const again = await refund('evt_r1', 2_600, new Date('2026-12-09T00:00:00.000Z'));
    expect(again.statusCode).toBe(200);
    expect(purchase()).toEqual(first);
  });

  test('an unknown payment intent is acknowledged with 200 and changes nothing', async () => {
    const { post, purchase } = await paidPurchase();
    const before = structuredClone(purchase());
    const res = await post(
      FakePaymentGateway.refundedEvent({
        eventId: 'evt_x',
        paymentIntentId: 'pi_unknown',
        amountRefundedCents: 2_600,
        createdAt: refundAt,
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(purchase()).toEqual(before);
  });

  test('a refund event with a bad signature is rejected', async () => {
    const { app } = await paidPurchase();
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'v1=forged' },
      payload: FakePaymentGateway.refundedEvent({
        eventId: 'evt_x',
        paymentIntentId: PI,
        amountRefundedCents: 1,
        createdAt: refundAt,
      }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('AJ-3 support: POST /api/test/stripe/complete/:sessionId', () => {
  test('is not registered without test hooks', async () => {
    const { app } = await setup({ actor: owner() });
    const res = await app.inject({ method: 'POST', url: '/api/test/stripe/complete/cs_fake_1' });
    expect(res.statusCode).toBe(404);
  });

  test('fulfils the fake session like the webhook: +2,500 and a "Starter pack" entry', async () => {
    const { app, starter } = await setup({ actor: owner(), testHooks: true });
    const checkout = await app.inject({
      method: 'POST',
      url: '/api/credits/checkout',
      payload: { packId: starter.id },
    });
    const url = new URL(createCheckout.response.parse(checkout.json()).checkoutUrl);
    const sessionId = url.searchParams.get('fake_session') ?? '';

    const done = await app.inject({
      method: 'POST',
      url: `/api/test/stripe/complete/${sessionId}`,
    });
    expect(done.json()).toEqual({ fulfilled: true });
    const again = await app.inject({
      method: 'POST',
      url: `/api/test/stripe/complete/${sessionId}`,
    });
    expect(again.json()).toEqual({ fulfilled: false });

    const wallet = getCredits.response.parse(
      (await app.inject({ method: 'GET', url: '/api/credits' })).json(),
    );
    expect(wallet.available).toBe(2500);
    const ledger = listLedger.response.parse(
      (await app.inject({ method: 'GET', url: '/api/credits/ledger' })).json(),
    );
    expect(ledger.items).toMatchObject([
      { type: 'purchase', credits: 2500, description: 'Starter pack' },
    ]);
  });
});

describe('FR-13: POST /api/staff/businesses/:id/credits', () => {
  const url = `/api/staff/businesses/${BUSINESS}/credits`;

  test('201 with the adjustment entry', async () => {
    const { app, billing } = await setup({ actor: staff() });
    const res = await app.inject({
      method: 'POST',
      url,
      payload: { credits: 1000, reason: 'beta tester' },
    });
    expect(res.statusCode).toBe(201);
    expect(grantCredits.response.parse(res.json())).toMatchObject({
      type: 'adjustment',
      credits: 1000,
      description: 'beta tester',
    });
    expect(billing.audit.entries.map((e) => e.action)).toEqual(['credits.adjusted']);
  });

  test('422 INSUFFICIENT_CREDITS with { available, required } when removing too much', async () => {
    const { app, fund } = await setup({ actor: staff() });
    await fund(100);
    const res = await app.inject({
      method: 'POST',
      url,
      payload: { credits: -150, reason: 'mistake' },
    });
    expect(res.statusCode).toBe(422);
    expect(insufficientCreditsError.parse(res.json()).error.details).toEqual({
      available: 100,
      required: 150,
    });
  });

  test('403 for an Owner, 400 for 0 credits or a missing reason', async () => {
    const asOwner = await setup({ actor: owner() });
    const forbidden = await asOwner.app.inject({
      method: 'POST',
      url,
      payload: { credits: 5, reason: 'x' },
    });
    expect(forbidden.statusCode).toBe(403);

    const { app } = await setup({ actor: staff() });
    for (const payload of [
      { credits: 0, reason: 'x' },
      { credits: 5, reason: '' },
      { credits: 5, reason: 'x'.repeat(201) },
    ]) {
      expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(400);
    }
  });
});

describe('FR-13: Staff Credit packs', () => {
  const input = { name: 'Growth', credits: 11_000, priceCents: 10_000, active: true };

  test('list, create and update', async () => {
    const { app, starter } = await setup({ actor: staff() });
    const created = await app.inject({
      method: 'POST',
      url: '/api/staff/credit-packs',
      payload: input,
    });
    expect(created.statusCode).toBe(201);
    const growth = creditPack.parse(created.json());
    expect(growth).toMatchObject(input);

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/staff/credit-packs/${starter.id}`,
      payload: { name: 'Starter', credits: 2500, priceCents: 2500, active: false },
    });
    expect(updated.statusCode).toBe(200);
    expect(creditPack.parse(updated.json()).active).toBe(false);

    const list = listCreditPacks.response.parse(
      (await app.inject({ method: 'GET', url: '/api/staff/credit-packs' })).json(),
    );
    expect(list).toEqual({
      items: [{ ...starter, active: false }, growth],
      nextCursor: null,
    });
  });

  test('403 for an Owner; 404 for an unknown pack; 400 for a price below 50 cents', async () => {
    const asOwner = await setup({ actor: owner() });
    expect(
      (await asOwner.app.inject({ method: 'GET', url: '/api/staff/credit-packs' })).statusCode,
    ).toBe(403);

    const { app } = await setup({ actor: staff() });
    const missing = await app.inject({
      method: 'PUT',
      url: '/api/staff/credit-packs/00000000-0000-7000-8000-0000000fffff',
      payload: input,
    });
    expect(missing.statusCode).toBe(404);
    const cheap = await app.inject({
      method: 'POST',
      url: '/api/staff/credit-packs',
      payload: { ...input, priceCents: 49 },
    });
    expect(cheap.statusCode).toBe(400);
  });
});
