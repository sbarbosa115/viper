import { describe, expect, test } from 'vitest';
import { CodedError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import { chargeableCredits } from '../domain/settlement.js';
import { FakePaymentGateway } from '../infrastructure/fake-payment-gateway.js';
import {
  actingAs,
  APP_URL,
  billingFixture,
  BUSINESS,
  OTHER_BUSINESS,
  owner,
  RUN,
  STAFF_ID,
  staff,
} from '../test/billing-fixture.js';

async function expectCoded(promise: Promise<unknown>, code: string): Promise<CodedError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CodedError);
    expect((error as CodedError).code).toBe(code);
    return error as CodedError;
  }
  throw new Error(`expected ${code}`);
}

describe('FR-10: Credit wallet', () => {
  test('given a grant of 1,000 and a settled run of 137, available is 863 and the ledger shows both', async () => {
    const f = billingFixture();
    await f.fund(1000);
    f.tick();
    await f.app.reservations.reserve({ businessId: BUSINESS, runId: RUN, credits: 400 });
    f.tick();
    await f.app.reservations.settle({
      runId: RUN,
      creditsSpent: 137,
      planName: 'Bakeries near Austin',
    });

    expect(await f.app.queries.getWallet(BUSINESS)).toEqual({
      businessId: BUSINESS,
      balance: 863,
      reserved: 0,
      available: 863,
    });
    const page = await f.app.queries.ledger(owner(), { limit: 25 });
    expect(page.items.map((e) => [e.type, e.credits, e.description, e.runId])).toEqual([
      ['settlement', -137, 'Run · Bakeries near Austin', RUN],
      ['adjustment', 1000, 'Beta credit', null],
    ]);
    expect(page.nextCursor).toBeNull();
  });

  test('given a running run with 400 reserved, reserved is 400 and available is balance − 400', async () => {
    const f = billingFixture();
    await f.fund(1000);
    await f.app.reservations.reserve({ businessId: BUSINESS, runId: RUN, credits: 400 });
    expect(await f.app.queries.getWallet(BUSINESS)).toMatchObject({
      balance: 1000,
      reserved: 400,
      available: 600,
    });
  });

  test('the credits page lists active packs in order and whether payments are available', async () => {
    const f = billingFixture();
    await f.fund(120);
    await f.app.creditPacks.ensure({
      name: 'Starter',
      credits: 2500,
      priceCents: 2500,
      active: true,
    });
    await f.app.creditPacks.ensure({ name: 'Old', credits: 10, priceCents: 100, active: false });
    await f.app.creditPacks.ensure({
      name: 'Growth',
      credits: 11000,
      priceCents: 10000,
      active: true,
    });
    f.gateway.available = false;

    const view = await f.app.queries.creditsPage(owner());
    expect(view).toMatchObject({
      balance: 120,
      reserved: 0,
      available: 120,
      paymentsAvailable: false,
    });
    expect(view.packs.map((p) => [p.name, p.credits, p.price])).toEqual([
      ['Starter', 2500, { cents: 2500, currency: 'usd' }],
      ['Growth', 11000, { cents: 10000, currency: 'usd' }],
    ]);
  });

  test("the public site's active packs are in order, without inactive ones or Stripe", async () => {
    const f = billingFixture();
    await f.app.creditPacks.ensure({
      name: 'Starter',
      credits: 2500,
      priceCents: 2500,
      active: true,
    });
    await f.app.creditPacks.ensure({ name: 'Old', credits: 10, priceCents: 100, active: false });
    await f.app.creditPacks.ensure({
      name: 'Growth',
      credits: 11000,
      priceCents: 10000,
      active: true,
    });
    f.gateway.available = false;

    const packs = await f.app.queries.activePacks();
    expect(packs.map(({ id: _id, ...p }) => p)).toEqual([
      { name: 'Starter', credits: 2500, priceCents: 2500 },
      { name: 'Growth', credits: 11000, priceCents: 10000 },
    ]);
    expect(packs.every((p) => typeof p.id === 'string' && p.id.length > 0)).toBe(true);
  });

  test('the ledger is newest first with cursor pagination, scoped to the Business', async () => {
    const f = billingFixture();
    for (let i = 1; i <= 5; i += 1) await f.fund(i);
    await f.fund(99, OTHER_BUSINESS);

    const first = await f.app.queries.ledger(owner(), { limit: 2 });
    expect(first.items.map((e) => e.credits)).toEqual([5, 4]);
    const second = await f.app.queries.ledger(owner(), {
      limit: 2,
      cursor: first.nextCursor ?? '',
    });
    expect(second.items.map((e) => e.credits)).toEqual([3, 2]);
    const third = await f.app.queries.ledger(owner(), {
      limit: 2,
      cursor: second.nextCursor ?? '',
    });
    expect(third.items.map((e) => e.credits)).toEqual([1]);
    expect(third.nextCursor).toBeNull();
  });

  test('an invalid cursor is a validation error', async () => {
    const f = billingFixture();
    await expect(f.app.queries.ledger(owner(), { limit: 2, cursor: 'nope' })).rejects.toMatchObject(
      {
        code: 'VALIDATION_ERROR',
      },
    );
  });
});

describe('FR-11: Trial credits', () => {
  test('given the event is delivered twice, exactly one grant exists', async () => {
    const f = billingFixture();
    expect(await f.app.grantTrialCredits.execute({ businessId: BUSINESS })).toEqual({
      granted: 50,
    });
    expect(await f.app.grantTrialCredits.execute({ businessId: BUSINESS })).toEqual({ granted: 0 });

    const grants = f.store.state.ledger.filter((e) => e.type === 'grant');
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      credits: 50,
      description: 'Free trial credits',
      idempotencyKey: `trial:${BUSINESS}`,
    });
  });

  test('uses the configured amount, and grants nothing when it is 0', async () => {
    expect(
      await billingFixture({ trialCredits: 75 }).app.grantTrialCredits.execute({
        businessId: BUSINESS,
      }),
    ).toEqual({
      granted: 75,
    });
    const none = billingFixture({ trialCredits: 0 });
    await none.app.grantTrialCredits.execute({ businessId: BUSINESS });
    expect(none.store.state.ledger).toHaveLength(0);
  });
});

describe('FR-12: Buy Credit packs with Stripe', () => {
  async function withStarter() {
    const f = billingFixture();
    const pack = await f.app.creditPacks.ensure({
      name: 'Starter',
      credits: 2500,
      priceCents: 2500,
      active: true,
    });
    return { ...f, pack };
  }

  test('a verified Owner gets a Checkout URL and a pending purchase', async () => {
    const f = await withStarter();
    const { checkoutUrl } = await f.app.startCheckout.execute({ packId: f.pack.id }, owner());

    const session = f.gateway.sessions[0];
    expect(session).toMatchObject({
      businessId: BUSINESS,
      packId: f.pack.id,
      packName: 'Starter',
      credits: 2500,
      amountCents: 2500,
      successUrl: `${APP_URL}/app/credits?purchase=success`,
      cancelUrl: `${APP_URL}/app/credits`,
    });
    expect(checkoutUrl).toBe(
      `${APP_URL}/app/credits?purchase=success&fake_session=${session?.sessionId}`,
    );
    expect(f.store.state.purchases).toMatchObject([
      {
        businessId: BUSINESS,
        packId: f.pack.id,
        status: 'pending',
        stripeSessionId: session?.sessionId,
      },
    ]);
  });

  test('not while Acting as (ACTING_AS_FORBIDDEN)', async () => {
    const f = await withStarter();
    await expectCoded(
      f.app.startCheckout.execute({ packId: f.pack.id }, actingAs()),
      'ACTING_AS_FORBIDDEN',
    );
  });

  test('not before the email is verified (EMAIL_NOT_VERIFIED)', async () => {
    const f = await withStarter();
    await expectCoded(
      f.app.startCheckout.execute({ packId: f.pack.id }, owner({ emailVerified: false })),
      'EMAIL_NOT_VERIFIED',
    );
  });

  test('only the Owner', async () => {
    const f = await withStarter();
    await expect(
      f.app.startCheckout.execute({ packId: f.pack.id }, owner({ roles: [] })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('Stripe not configured → PAYMENTS_UNAVAILABLE, nothing written', async () => {
    const f = await withStarter();
    f.gateway.available = false;
    await expectCoded(
      f.app.startCheckout.execute({ packId: f.pack.id }, owner()),
      'PAYMENTS_UNAVAILABLE',
    );
    expect(f.store.state.purchases).toHaveLength(0);
  });

  test('an inactive or unknown pack is not found', async () => {
    const f = await withStarter();
    const old = await f.app.creditPacks.ensure({
      name: 'Old',
      credits: 10,
      priceCents: 100,
      active: false,
    });
    await expect(f.app.startCheckout.execute({ packId: old.id }, owner())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      f.app.startCheckout.execute({ packId: '00000000-0000-7000-8000-0000000fffff' }, owner()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('given a completed checkout webhook delivered 3 times, the wallet increases by the pack credits once', async () => {
    const f = await withStarter();
    await f.app.startCheckout.execute({ packId: f.pack.id }, owner());
    const sessionId = f.gateway.sessions[0]?.sessionId ?? '';
    const body = Buffer.from(
      FakePaymentGateway.completedEvent({ eventId: 'evt_1', sessionId, taxCents: 206 }),
    );

    for (let i = 0; i < 3; i += 1) {
      await f.app.handleStripeWebhook.execute({
        rawBody: body,
        signature: FakePaymentGateway.sign(body),
      });
    }

    expect((await f.app.queries.getWallet(BUSINESS)).available).toBe(2500);
    const purchases = f.store.state.ledger.filter((e) => e.type === 'purchase');
    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({ credits: 2500, description: 'Starter pack' });
    expect(f.store.state.purchases[0]).toMatchObject({
      status: 'paid',
      stripeEventId: 'evt_1',
      taxCents: 206,
    });
    expect(f.store.state.events).toEqual([
      {
        type: 'CreditPackPurchased',
        payload: {
          purchaseId: f.store.state.purchases[0]?.id,
          businessId: BUSINESS,
          packId: f.pack.id,
          credits: 2500,
          amountCents: 2500,
        },
      },
    ]);
    expect(f.analytics.events).toEqual([
      {
        name: 'credit_pack_purchased',
        properties: {
          business_id: BUSINESS,
          pack_id: f.pack.id,
          credits: 2500,
          amount_cents: 2500,
        },
      },
    ]);
  });

  test('a different event for an already paid session adds nothing (idempotent by session id)', async () => {
    const f = await withStarter();
    await f.app.startCheckout.execute({ packId: f.pack.id }, owner());
    const sessionId = f.gateway.sessions[0]?.sessionId ?? '';
    await f.app.fulfilPurchase.execute({ sessionId, eventId: 'evt_1', taxCents: 0 });
    expect(
      await f.app.fulfilPurchase.execute({ sessionId, eventId: 'evt_2', taxCents: 0 }),
    ).toEqual({
      fulfilled: false,
    });
    expect((await f.app.queries.getWallet(BUSINESS)).balance).toBe(2500);
  });

  test('a bad signature is rejected (INVALID_SIGNATURE) and nothing is written', async () => {
    const f = await withStarter();
    await f.app.startCheckout.execute({ packId: f.pack.id }, owner());
    const sessionId = f.gateway.sessions[0]?.sessionId ?? '';
    const body = Buffer.from(FakePaymentGateway.completedEvent({ eventId: 'evt_1', sessionId }));
    await expectCoded(
      f.app.handleStripeWebhook.execute({ rawBody: body, signature: 'v1=forged' }),
      'INVALID_SIGNATURE',
    );
    expect(f.store.state.ledger).toHaveLength(0);
  });

  test('other events, unpaid sessions and unknown sessions are acknowledged without writing', async () => {
    const f = await withStarter();
    const other = Buffer.from(
      JSON.stringify({ id: 'evt_x', type: 'invoice.paid', data: { object: {} } }),
    );
    await f.app.handleStripeWebhook.execute({
      rawBody: other,
      signature: FakePaymentGateway.sign(other),
    });
    const unknown = Buffer.from(
      FakePaymentGateway.completedEvent({ eventId: 'evt_y', sessionId: 'cs_unknown' }),
    );
    await f.app.handleStripeWebhook.execute({
      rawBody: unknown,
      signature: FakePaymentGateway.sign(unknown),
    });
    expect(f.store.state.ledger).toHaveLength(0);
    expect(f.analytics.events).toHaveLength(0);
  });
});

describe('FR-12: payments that settle later (Stripe async payment events)', () => {
  async function delayedCheckout() {
    const f = billingFixture();
    const pack = await f.app.creditPacks.ensure({
      name: 'Starter',
      credits: 2500,
      priceCents: 2500,
      active: true,
    });
    await f.app.startCheckout.execute({ packId: pack.id }, owner());
    const sessionId = f.gateway.sessions[0]?.sessionId ?? '';
    const deliver = async (body: string) => {
      const raw = Buffer.from(body);
      await f.app.handleStripeWebhook.execute({
        rawBody: raw,
        signature: FakePaymentGateway.sign(raw),
      });
    };
    // The session completes before the money arrives: nothing yet.
    await deliver(
      FakePaymentGateway.completedEvent({ eventId: 'evt_1', sessionId, paymentStatus: 'unpaid' }),
    );
    expect(f.store.state.ledger.filter((e) => e.type === 'purchase')).toHaveLength(0);
    expect(f.store.state.purchases[0]?.status).toBe('pending');
    return { ...f, pack, sessionId, deliver };
  }

  test('async_payment_succeeded adds the pack credits once, however often it arrives', async () => {
    const f = await delayedCheckout();
    const succeeded = FakePaymentGateway.completedEvent({
      eventId: 'evt_2',
      sessionId: f.sessionId,
      type: 'checkout.session.async_payment_succeeded',
    });
    await f.deliver(succeeded);
    await f.deliver(succeeded);
    expect((await f.app.queries.getWallet(BUSINESS)).available).toBe(2500);
    expect(f.store.state.ledger.filter((e) => e.type === 'purchase')).toHaveLength(1);
    expect(f.store.state.purchases[0]).toMatchObject({ status: 'paid', stripeEventId: 'evt_2' });
    expect(f.store.state.events).toHaveLength(1);
  });

  test('async_payment_failed marks the purchase failed and adds nothing', async () => {
    const f = await delayedCheckout();
    await f.deliver(
      FakePaymentGateway.completedEvent({
        eventId: 'evt_3',
        sessionId: f.sessionId,
        type: 'checkout.session.async_payment_failed',
      }),
    );
    expect(f.store.state.purchases[0]?.status).toBe('failed');
    expect((await f.app.queries.getWallet(BUSINESS)).available).toBe(0);
    expect(f.store.state.events).toHaveLength(0);
    expect(f.analytics.events.filter((e) => e.name === 'credit_pack_purchased')).toHaveLength(0);
  });

  test('a failed event for a paid purchase changes nothing', async () => {
    const f = await delayedCheckout();
    await f.deliver(
      FakePaymentGateway.completedEvent({
        eventId: 'evt_2',
        sessionId: f.sessionId,
        type: 'checkout.session.async_payment_succeeded',
      }),
    );
    await f.deliver(
      FakePaymentGateway.completedEvent({
        eventId: 'evt_3',
        sessionId: f.sessionId,
        type: 'checkout.session.async_payment_failed',
      }),
    );
    expect(f.store.state.purchases[0]?.status).toBe('paid');
    expect((await f.app.queries.getWallet(BUSINESS)).available).toBe(2500);
  });
});

describe('FR-13: Staff credit grants and Credit packs', () => {
  test('given Staff grant 1,000 credits to B with reason "beta tester", B’s ledger shows an adjustment with that reason', async () => {
    const f = billingFixture();
    const entry = await f.app.adjustCredits.execute(
      { businessId: BUSINESS, credits: 1000, reason: 'beta tester' },
      staff(),
    );
    expect(entry).toMatchObject({ type: 'adjustment', credits: 1000, description: 'beta tester' });
    const page = await f.app.queries.ledger(owner(), { limit: 25 });
    expect(page.items).toEqual([entry]);
    expect(f.store.state.ledger[0]?.createdByMemberId).toBe(STAFF_ID);
    expect(f.audit.entries).toEqual([
      {
        staffMemberId: STAFF_ID,
        businessId: BUSINESS,
        action: 'credits.adjusted',
        targetType: 'credit_ledger',
        targetId: entry.id,
        details: { credits: 1000, reason: 'beta tester' },
      },
    ]);
  });

  test('the grant and its Audit entry are one transaction: a failed audit write rolls the grant back', async () => {
    const f = billingFixture();
    f.audit.failNext = new Error('audit log down');
    await expect(
      f.app.adjustCredits.execute(
        { businessId: BUSINESS, credits: 1000, reason: 'beta tester' },
        staff(),
      ),
    ).rejects.toThrow('audit log down');
    expect(f.store.state.ledger).toHaveLength(0);
  });

  test('a pack change and its Audit entry are one transaction', async () => {
    const f = billingFixture();
    f.audit.failNext = new Error('audit log down');
    await expect(
      f.app.creditPacks.create(
        { name: 'Starter', credits: 2500, priceCents: 2500, active: true },
        staff(),
      ),
    ).rejects.toThrow('audit log down');
    expect(f.store.state.packs).toHaveLength(0);
    const pack = await f.app.creditPacks.create(
      { name: 'Starter', credits: 2500, priceCents: 2500, active: true },
      staff(),
    );
    f.audit.failNext = new Error('audit log down');
    await expect(
      f.app.creditPacks.update(
        pack.id,
        { name: 'Starter', credits: 3000, priceCents: 2500, active: true },
        staff(),
      ),
    ).rejects.toThrow('audit log down');
    expect(f.store.state.packs[0]?.credits).toBe(2500);
  });

  test('removing credits cannot take available below 0 (INSUFFICIENT_CREDITS)', async () => {
    const f = billingFixture();
    await f.fund(500);
    await f.app.reservations.reserve({ businessId: BUSINESS, runId: RUN, credits: 400 });
    const error = await expectCoded(
      f.app.adjustCredits.execute(
        { businessId: BUSINESS, credits: -101, reason: 'mistake' },
        staff(),
      ),
      'INSUFFICIENT_CREDITS',
    );
    expect(error.details).toEqual({ available: 100, required: 101 });
    await f.app.adjustCredits.execute(
      { businessId: BUSINESS, credits: -100, reason: 'mistake' },
      staff(),
    );
    expect((await f.app.queries.getWallet(BUSINESS)).available).toBe(0);
  });

  test('only Staff; unknown Business is not found', async () => {
    const f = billingFixture();
    await expect(
      f.app.adjustCredits.execute({ businessId: BUSINESS, credits: 5, reason: 'x' }, owner()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      f.app.adjustCredits.execute(
        { businessId: '00000000-0000-7000-8000-0000000fffff', credits: 5, reason: 'x' },
        staff(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(f.audit.entries).toHaveLength(0);
  });

  test('Staff create, list and update packs, each change audited', async () => {
    const f = billingFixture();
    const starter = await f.app.creditPacks.create(
      { name: 'Starter', credits: 2500, priceCents: 2500, active: true },
      staff(),
    );
    const pro = await f.app.creditPacks.create(
      { name: 'Pro', credits: 30000, priceCents: 25000, active: true },
      staff(),
    );
    const updated = await f.app.creditPacks.update(
      starter.id,
      { name: 'Starter', credits: 3000, priceCents: 2500, active: false },
      staff(),
    );
    expect(updated).toEqual({ ...starter, credits: 3000, active: false });
    expect(await f.app.creditPacks.list(staff())).toEqual([updated, pro]);
    expect(f.audit.entries.map((e) => [e.action, e.targetType, e.targetId, e.businessId])).toEqual([
      ['credit_pack.created', 'credit_pack', starter.id, null],
      ['credit_pack.created', 'credit_pack', pro.id, null],
      ['credit_pack.updated', 'credit_pack', starter.id, null],
    ]);
  });

  test('pack management is Staff only; updating an unknown pack is not found', async () => {
    const f = billingFixture();
    const input = { name: 'X', credits: 1, priceCents: 50, active: true };
    await expect(f.app.creditPacks.list(owner())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(f.app.creditPacks.create(input, owner())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      f.app.creditPacks.update('00000000-0000-7000-8000-0000000fffff', input, staff()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('FR-18/FR-20/FR-36: Reservations for research', () => {
  test('given 300 available and 400 required, INSUFFICIENT_CREDITS with { available: 300, required: 400 }', async () => {
    const f = billingFixture();
    await f.fund(300);
    const error = await expectCoded(
      f.app.reservations.reserve({ businessId: BUSINESS, runId: RUN, credits: 400 }),
      'INSUFFICIENT_CREDITS',
    );
    expect(error.details).toEqual({ available: 300, required: 400 });
    expect(f.store.state.reservations).toHaveLength(0);
  });

  test('reserve is idempotent per run', async () => {
    const f = billingFixture();
    await f.fund(1000);
    await f.app.reservations.reserve({ businessId: BUSINESS, runId: RUN, credits: 400 });
    const again = await f.app.reservations.reserve({
      businessId: BUSINESS,
      runId: RUN,
      credits: 400,
    });
    expect(again).toMatchObject({ credits: 400, status: 'open' });
    expect((await f.app.queries.getWallet(BUSINESS)).reserved).toBe(400);
  });

  test('tool calls of 136,200 millicredits settle 137 credits and release 263 of 400', async () => {
    const f = billingFixture();
    await f.fund(1000);
    await f.app.reservations.reserve({ businessId: BUSINESS, runId: RUN, credits: 400 });
    const creditsSpent = chargeableCredits({
      millicreditsSpent: 136_200,
      outcome: 'completed',
      leadsDelivered: 25,
    });
    expect(await f.app.reservations.settle({ runId: RUN, creditsSpent })).toEqual({
      charged: 137,
      released: 263,
    });
    expect(await f.app.queries.getWallet(BUSINESS)).toMatchObject({ balance: 863, reserved: 0 });
  });

  test('a run that fails with 0 Leads settles 0 and releases the full Reservation', async () => {
    const f = billingFixture();
    await f.fund(1000);
    await f.app.reservations.reserve({ businessId: BUSINESS, runId: RUN, credits: 400 });
    const creditsSpent = chargeableCredits({
      millicreditsSpent: 41_000,
      outcome: 'failed',
      leadsDelivered: 0,
    });
    expect(await f.app.reservations.settle({ runId: RUN, creditsSpent })).toEqual({
      charged: 0,
      released: 400,
    });
    expect(await f.app.queries.getWallet(BUSINESS)).toMatchObject({
      balance: 1000,
      available: 1000,
    });
    expect(f.store.state.ledger.filter((e) => e.type === 'settlement')).toHaveLength(0);
  });

  test('settle and release are idempotent; unknown runs are handled', async () => {
    const f = billingFixture();
    await f.fund(1000);
    await f.app.reservations.reserve({ businessId: BUSINESS, runId: RUN, credits: 400 });
    await f.app.reservations.settle({ runId: RUN, creditsSpent: 137 });
    expect(await f.app.reservations.settle({ runId: RUN, creditsSpent: 137 })).toEqual({
      charged: 0,
      released: 0,
    });
    expect(await f.app.reservations.release({ runId: RUN })).toEqual({ charged: 0, released: 0 });
    expect((await f.app.queries.getWallet(BUSINESS)).balance).toBe(863);

    expect(await f.app.reservations.release({ runId: 'missing' })).toEqual({
      charged: 0,
      released: 0,
    });
    await expect(
      f.app.reservations.settle({ runId: 'missing', creditsSpent: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('release gives the whole hold back without a ledger entry', async () => {
    const f = billingFixture();
    await f.fund(1000);
    await f.app.reservations.reserve({ businessId: BUSINESS, runId: RUN, credits: 400 });
    expect(await f.app.reservations.release({ runId: RUN })).toEqual({ charged: 0, released: 400 });
    expect(await f.app.queries.getWallet(BUSINESS)).toMatchObject({ balance: 1000, reserved: 0 });
    expect(f.store.state.ledger).toHaveLength(1);
  });

  test('FR-36: a resume reserves the remaining budget and the final Settlement charges the run total once', async () => {
    const f = billingFixture();
    await f.fund(1000);
    await f.app.reservations.reserve({ businessId: BUSINESS, runId: RUN, credits: 400 });
    // Attempt 1 failed with no Leads: free.
    await f.app.reservations.settle({ runId: RUN, creditsSpent: 0 });
    // Staff resume: a new hold for the remaining budget.
    await f.app.reservations.topUpReservation({ runId: RUN, credits: 400 });
    expect((await f.app.queries.getWallet(BUSINESS)).reserved).toBe(400);
    // The run completes; its total real cost across attempts is 150.
    expect(await f.app.reservations.settle({ runId: RUN, creditsSpent: 150 })).toEqual({
      charged: 150,
      released: 250,
    });
    expect(await f.app.queries.getWallet(BUSINESS)).toMatchObject({ balance: 850, reserved: 0 });
  });

  test('FR-36: a top-up needs available credits; an unknown run is not found', async () => {
    const f = billingFixture();
    await f.fund(500);
    await f.app.reservations.reserve({ businessId: BUSINESS, runId: RUN, credits: 400 });
    const error = await expectCoded(
      f.app.reservations.topUpReservation({ runId: RUN, credits: 101 }),
      'INSUFFICIENT_CREDITS',
    );
    expect(error.details).toEqual({ available: 100, required: 101 });
    await expect(
      f.app.reservations.topUpReservation({ runId: 'missing', credits: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('Staff reporting figures', () => {
  test('summarises credits granted, purchased, spent and revenue, excluding internal Businesses', async () => {
    const f = billingFixture();
    await f.app.grantTrialCredits.execute({ businessId: BUSINESS });
    await f.fund(950);
    await f.fund(10_000, OTHER_BUSINESS);
    await f.app.reservations.reserve({ businessId: BUSINESS, runId: RUN, credits: 400 });
    await f.app.reservations.settle({ runId: RUN, creditsSpent: 137 });

    const summary = await f.app.queries.creditsSummary({
      from: new Date('2026-11-01T00:00:00.000Z'),
      to: new Date('2026-12-01T00:00:00.000Z'),
      excludeBusinessIds: [OTHER_BUSINESS],
    });
    expect(summary).toEqual({
      packRevenueCents: 0,
      creditsGranted: 1000,
      creditsPurchased: 0,
      creditsSpent: 137,
      unspentCredits: 863,
    });
    expect(await f.app.queries.availableByBusiness([BUSINESS, OTHER_BUSINESS])).toEqual(
      new Map([
        [BUSINESS, 863],
        [OTHER_BUSINESS, 10_000],
      ]),
    );
  });
});
