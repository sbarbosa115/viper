import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { CodedError } from '../../../shared/domain/errors.js';
import { createBilling, seed } from '../index.js';
import { FakePaymentGateway } from './fake-payment-gateway.js';
import { FixedTrialCredits, RecordingAuditRecorder } from './in-memory-billing.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const clock = new FixedClock(new Date('2026-11-19T10:00:00.000Z'));
const ids = new Uuid7Generator();
const BUSINESS = '00000000-0000-7000-8000-00000000b001';
const OTHER = '00000000-0000-7000-8000-00000000b002';
const STAFF = '00000000-0000-7000-8000-00000000c002';

function build() {
  const analytics = new RecordingAnalyticsTracker();
  const gateway = new FakePaymentGateway(ids, 'http://localhost:5173');
  const billing = createBilling({
    db,
    clock,
    ids,
    analytics,
    gateway,
    audit: new RecordingAuditRecorder(),
    trialCredits: new FixedTrialCredits(50),
    appUrl: 'http://localhost:5173',
  });
  return { ...billing, app: billing.application, analytics, gateway };
}

const tick = () => clock.set(new Date(clock.now().getTime() + 1000));

async function fund(credits: number, businessId = BUSINESS) {
  tick();
  return build().app.adjustCredits.apply({ businessId, credits, reason: 'Beta', memberId: STAFF });
}

beforeEach(async () => {
  await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
  for (const table of [
    'credit_ledger',
    'reservations',
    'purchases',
    'credit_packs',
    'credit_wallets',
    'outbox',
  ]) {
    await sql.raw(`TRUNCATE TABLE ${table}`).execute(db);
  }
  await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);
});

afterAll(async () => {
  await db.destroy();
});

describe('ADR 0009: concurrency-safe Reservations (MySQL)', () => {
  test('20 concurrent reserves of 100 against 1,000 available: exactly 10 succeed, never negative', async () => {
    await fund(1000);
    const { billingCommands } = build();
    const runIds = Array.from({ length: 20 }, () => ids.next());

    const results = await Promise.allSettled(
      runIds.map((runId) => billingCommands.reserve({ businessId: BUSINESS, runId, credits: 100 })),
    );

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(10);
    expect(failed).toHaveLength(10);
    for (const f of failed) {
      expect(f.reason).toBeInstanceOf(CodedError);
      expect((f.reason as CodedError).code).toBe('INSUFFICIENT_CREDITS');
    }
    expect(await build().billingQueries.getWallet(BUSINESS)).toMatchObject({
      balance: 1000,
      reserved: 1000,
      available: 0,
    });
  });

  test('concurrent reserve, settle and release on different runs keep the totals exact', async () => {
    await fund(1000);
    const { billingCommands: c } = build();
    const [a, b, d] = [ids.next(), ids.next(), ids.next()];
    await c.reserve({ businessId: BUSINESS, runId: a, credits: 400 });
    await c.reserve({ businessId: BUSINESS, runId: b, credits: 400 });

    await Promise.all([
      c.settle({ runId: a, creditsSpent: 137 }),
      c.release({ runId: b }),
      c.reserve({ businessId: BUSINESS, runId: d, credits: 200 }),
      c.settle({ runId: a, creditsSpent: 137 }),
      c.reserve({ businessId: BUSINESS, runId: d, credits: 200 }),
    ]);

    expect(await build().billingQueries.getWallet(BUSINESS)).toEqual({
      businessId: BUSINESS,
      balance: 863,
      reserved: 200,
      available: 663,
    });
    const settlements = await db
      .selectFrom('credit_ledger')
      .selectAll()
      .where('type', '=', 'settlement')
      .execute();
    expect(settlements).toHaveLength(1);
  });

  test('reserve joins the caller transaction: a rollback leaves no Reservation', async () => {
    await fund(1000);
    const { billingCommands } = build();
    const runId = ids.next();
    await expect(
      db.transaction().execute(async (trx) => {
        await billingCommands.reserve({ businessId: BUSINESS, runId, credits: 400 }, trx);
        throw new Error('run insert failed');
      }),
    ).rejects.toThrow('run insert failed');
    expect((await build().billingQueries.getWallet(BUSINESS)).reserved).toBe(0);
  });

  test('settle math: 137 charged, 263 released from 400, as a Settlement entry on the run', async () => {
    await fund(1000);
    const { billingCommands } = build();
    const runId = ids.next();
    await billingCommands.reserve({ businessId: BUSINESS, runId, credits: 400 });
    tick();
    expect(
      await billingCommands.settle({ runId, creditsSpent: 137, planName: 'Bakeries near Austin' }),
    ).toEqual({ charged: 137, released: 263 });
    const row = await db
      .selectFrom('reservations')
      .selectAll()
      .where('run_id', '=', runId)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: 'settled', credits: 400, closed_at: clock.now() });
    const entry = await db
      .selectFrom('credit_ledger')
      .selectAll()
      .where('run_id', '=', runId)
      .executeTakeFirstOrThrow();
    expect(entry).toMatchObject({
      type: 'settlement',
      credits: -137,
      description: 'Run · Bakeries near Austin',
    });
  });
});

describe('FR-11: trial grant (MySQL)', () => {
  test('concurrent deliveries grant exactly once', async () => {
    const { app } = build();
    await Promise.all([1, 2, 3].map(() => app.grantTrialCredits.execute({ businessId: BUSINESS })));
    const grants = await db
      .selectFrom('credit_ledger')
      .selectAll()
      .where('type', '=', 'grant')
      .execute();
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ credits: 50, idempotency_key: `trial:${BUSINESS}` });
  });
});

describe('FR-12: Stripe webhook idempotency (MySQL)', () => {
  test('3 deliveries (2 at once) add the pack once and publish CreditPackPurchased once', async () => {
    const { app, gateway, analytics } = build();
    const pack = await app.creditPacks.ensure({
      name: 'Starter',
      credits: 2500,
      priceCents: 2500,
      active: true,
    });
    await app.startCheckout.execute(
      { packId: pack.id },
      { memberId: STAFF, businessId: BUSINESS, roles: ['owner'], emailVerified: true },
    );
    const sessionId = gateway.sessions[0]?.sessionId ?? '';
    const body = Buffer.from(FakePaymentGateway.completedEvent({ eventId: 'evt_1', sessionId }));
    const deliver = () =>
      app.handleStripeWebhook.execute({ rawBody: body, signature: FakePaymentGateway.sign(body) });

    await Promise.all([deliver(), deliver()]);
    await deliver();

    expect((await build().billingQueries.getWallet(BUSINESS)).available).toBe(2500);
    expect(
      await db.selectFrom('credit_ledger').selectAll().where('type', '=', 'purchase').execute(),
    ).toHaveLength(1);
    const outbox = await db.selectFrom('outbox').selectAll().execute();
    expect(outbox.map((o) => o.type)).toEqual(['CreditPackPurchased']);
    expect(analytics.events.map((e) => e.name)).toEqual(['credit_pack_purchased']);
    const purchase = await db.selectFrom('purchases').selectAll().executeTakeFirstOrThrow();
    expect(purchase).toMatchObject({ status: 'paid', stripe_event_id: 'evt_1', credits: 2500 });
  });

  test('a delayed payment that fails is stored as failed, with no credits', async () => {
    const { app, gateway } = build();
    const pack = await app.creditPacks.ensure({
      name: 'Starter',
      credits: 2500,
      priceCents: 2500,
      active: true,
    });
    await app.startCheckout.execute(
      { packId: pack.id },
      { memberId: STAFF, businessId: BUSINESS, roles: ['owner'], emailVerified: true },
    );
    const sessionId = gateway.sessions[0]?.sessionId ?? '';
    const body = Buffer.from(
      FakePaymentGateway.completedEvent({
        eventId: 'evt_9',
        sessionId,
        type: 'checkout.session.async_payment_failed',
      }),
    );
    await app.handleStripeWebhook.execute({
      rawBody: body,
      signature: FakePaymentGateway.sign(body),
    });
    const purchase = await db.selectFrom('purchases').selectAll().executeTakeFirstOrThrow();
    expect(purchase.status).toBe('failed');
    expect((await build().billingQueries.getWallet(BUSINESS)).available).toBe(0);
  });
});

describe('FR-10: ledger list (MySQL)', () => {
  test('newest first, cursor pagination, scoped to the Business', async () => {
    for (let i = 1; i <= 5; i += 1) await fund(i);
    await fund(99, OTHER);
    const actor = {
      memberId: STAFF,
      businessId: BUSINESS,
      roles: ['owner'] as const,
      emailVerified: true,
    };
    const { app } = build();

    const first = await app.queries.ledger(actor, { limit: 3 });
    expect(first.items.map((e) => e.credits)).toEqual([5, 4, 3]);
    const second = await app.queries.ledger(actor, { limit: 3, cursor: first.nextCursor ?? '' });
    expect(second.items.map((e) => e.credits)).toEqual([2, 1]);
    expect(second.nextCursor).toBeNull();
  });

  test('entries at the same time page by id without gaps or repeats', async () => {
    const { app } = build();
    for (let i = 1; i <= 4; i += 1) {
      await app.adjustCredits.apply({
        businessId: BUSINESS,
        credits: i,
        reason: 'x',
        memberId: null,
      });
    }
    const actor = {
      memberId: STAFF,
      businessId: BUSINESS,
      roles: ['owner'] as const,
      emailVerified: true,
    };
    const first = await app.queries.ledger(actor, { limit: 2 });
    const second = await app.queries.ledger(actor, { limit: 2, cursor: first.nextCursor ?? '' });
    const credits = [...first.items, ...second.items].map((e) => e.credits);
    expect(credits.sort()).toEqual([1, 2, 3, 4]);
    expect(second.nextCursor).toBeNull();
  });
});

describe('Staff reporting figures (MySQL)', () => {
  test('creditsSummary, availableByBusiness and payingBusinessIds', async () => {
    const { app, gateway, billingQueries } = build();
    await app.grantTrialCredits.execute({ businessId: BUSINESS });
    await fund(950);
    await fund(10_000, OTHER);
    const runId = ids.next();
    await app.reservations.reserve({ businessId: BUSINESS, runId, credits: 400 });
    await app.reservations.settle({ runId, creditsSpent: 137 });
    const pack = await app.creditPacks.ensure({
      name: 'Starter',
      credits: 2500,
      priceCents: 2500,
      active: true,
    });
    await app.startCheckout.execute(
      { packId: pack.id },
      { memberId: STAFF, businessId: OTHER, roles: ['owner'], emailVerified: true },
    );
    await app.fulfilPurchase.execute({
      sessionId: gateway.sessions[0]?.sessionId ?? '',
      eventId: 'e',
      taxCents: 0,
    });

    const period = {
      from: new Date('2026-11-01T00:00:00.000Z'),
      to: new Date('2026-12-01T00:00:00.000Z'),
    };
    expect(await billingQueries.creditsSummary({ ...period, excludeBusinessIds: [] })).toEqual({
      packRevenueCents: 2500,
      creditsGranted: 11_000,
      creditsPurchased: 2500,
      creditsSpent: 137,
      unspentCredits: 863 + 12_500,
    });
    expect(
      await billingQueries.creditsSummary({ ...period, excludeBusinessIds: [OTHER] }),
    ).toMatchObject({
      packRevenueCents: 0,
      unspentCredits: 863,
    });
    expect(await billingQueries.availableByBusiness([BUSINESS, OTHER, STAFF])).toEqual(
      new Map([
        [BUSINESS, 863],
        [OTHER, 12_500],
        [STAFF, 0],
      ]),
    );
    expect(await billingQueries.payingBusinessIds([BUSINESS, OTHER])).toEqual(new Set([OTHER]));
    const paidAt = clock.now();
    expect(await billingQueries.payingBusinessIds([OTHER], { paidBefore: paidAt })).toEqual(
      new Set(),
    );
    expect(
      await billingQueries.payingBusinessIds([OTHER], {
        paidBefore: new Date(paidAt.getTime() + 1),
      }),
    ).toEqual(new Set([OTHER]));
    expect(await billingQueries.payingBusinessIds([], { paidBefore: paidAt })).toEqual(new Set());
  });
});

describe('PRD 8a: demo seed', () => {
  const demo = {
    businesses: {
      sweetSupply: '00000000-0000-7000-8000-00000000d001',
      cleanDesk: '00000000-0000-7000-8000-00000000d002',
      cornerCoffee: '00000000-0000-7000-8000-00000000d003',
    },
    members: { staff: '00000000-0000-7000-8000-00000000d104' },
    runs: { bakeriesNearAustin: '00000000-0000-7000-8000-00000000d401' },
  };

  test('creates the packs and wallets (863, 50, 120) and is idempotent', async () => {
    await seed({ db, clock, ids, demo });
    await seed({ db, clock, ids, demo });

    const { billingQueries: q } = build();
    expect((await q.getWallet(demo.businesses.sweetSupply)).available).toBe(863);
    expect((await q.getWallet(demo.businesses.cleanDesk)).available).toBe(50);
    expect((await q.getWallet(demo.businesses.cornerCoffee)).available).toBe(120);

    const sweet = await db
      .selectFrom('credit_ledger')
      .select(['type', 'credits', 'description', 'run_id'])
      .where('business_id', '=', demo.businesses.sweetSupply)
      .orderBy('credits', 'desc')
      .execute();
    expect(sweet).toEqual([
      { type: 'adjustment', credits: 950, description: 'Beta credit from Llyner', run_id: null },
      { type: 'grant', credits: 50, description: 'Free trial credits', run_id: null },
      {
        type: 'settlement',
        credits: -137,
        description: 'Run · Bakeries near Austin',
        run_id: demo.runs.bakeriesNearAustin,
      },
    ]);
    const packs = await db
      .selectFrom('credit_packs')
      .select(['name', 'credits', 'price_cents', 'active'])
      .orderBy('position')
      .execute();
    expect(packs).toEqual([
      { name: 'Starter', credits: 2500, price_cents: 2500, active: 1 },
      { name: 'Growth', credits: 11_000, price_cents: 10_000, active: 1 },
      { name: 'Pro', credits: 30_000, price_cents: 25_000, active: 1 },
    ]);
  });
});

describe('prd-expenses FR-7: refunds and revenueForMonth (MySQL)', () => {
  async function pack() {
    return build().app.creditPacks.ensure({
      name: 'Growth',
      credits: 11_000,
      priceCents: 9_900,
      active: true,
    });
  }

  async function insertPurchase(
    packId: string,
    key: string,
    fields: {
      paidAt: string | null;
      status?: 'paid' | 'pending';
      amountCents?: number;
      taxCents?: number;
      refundedCents?: number;
      refundedAt?: string | null;
    },
  ) {
    await db
      .insertInto('purchases')
      .values({
        id: ids.next(),
        business_id: BUSINESS,
        pack_id: packId,
        credits: 11_000,
        stripe_session_id: `cs_${key}`,
        stripe_event_id: null,
        stripe_payment_intent_id: `pi_${key}`,
        amount_cents: fields.amountCents ?? 9_900,
        tax_cents: fields.taxCents ?? 0,
        refunded_cents: fields.refundedCents ?? 0,
        status: fields.status ?? 'paid',
        created_at: new Date('2026-11-01T00:00:00.000Z'),
        paid_at: fields.paidAt ? new Date(fields.paidAt) : null,
        refunded_at: fields.refundedAt ? new Date(fields.refundedAt) : null,
      })
      .execute();
  }

  test('payment intent is stored when paid; charge.refunded is cumulative and idempotent', async () => {
    const { app, gateway } = build();
    const growth = await pack();
    await app.startCheckout.execute(
      { packId: growth.id },
      { memberId: STAFF, businessId: BUSINESS, roles: ['owner'], emailVerified: true },
    );
    const sessionId = gateway.sessions[0]?.sessionId ?? '';
    await app.fulfilPurchase.execute({
      sessionId,
      eventId: 'evt_1',
      taxCents: 0,
      paymentIntentId: 'pi_777',
    });
    const read = () => db.selectFrom('purchases').selectAll().executeTakeFirstOrThrow();
    expect((await read()).stripe_payment_intent_id).toBe('pi_777');

    const at = new Date('2026-12-03T09:00:00.000Z');
    expect(
      await app.handleStripeWebhook.execute({
        rawBody: Buffer.from(
          FakePaymentGateway.refundedEvent({
            eventId: 'evt_r',
            paymentIntentId: 'pi_777',
            amountRefundedCents: 9_900,
            createdAt: at,
          }),
        ),
        signature: FakePaymentGateway.sign(
          FakePaymentGateway.refundedEvent({
            eventId: 'evt_r',
            paymentIntentId: 'pi_777',
            amountRefundedCents: 9_900,
            createdAt: at,
          }),
        ),
      }),
    ).toEqual({});
    expect(await read()).toMatchObject({ refunded_cents: 9_900, refunded_at: at });
    const again = { paymentIntentId: 'pi_777', refundedCents: 9_900 };
    await app.recordRefund.execute({ ...again, occurredAt: new Date('2026-12-09T00:00:00.000Z') });
    await app.recordRefund.execute({
      paymentIntentId: 'pi_777',
      refundedCents: 100,
      occurredAt: new Date('2026-12-10T00:00:00.000Z'),
    });
    expect(await read()).toMatchObject({ refunded_cents: 9_900, refunded_at: at });
    expect(
      await app.recordRefund.execute({ ...again, paymentIntentId: 'pi_nope', occurredAt: at }),
    ).toEqual({ found: false });
  });

  test('revenueForMonth: UTC month edges, paid only; refunds by refunded_at', async () => {
    const { billingQueries } = build();
    const growth = await pack();
    await insertPurchase(growth.id, 'oct-last', { paidAt: '2026-10-31T23:59:59.999Z' });
    await insertPurchase(growth.id, 'nov-first', { paidAt: '2026-11-01T00:00:00.000Z' });
    await insertPurchase(growth.id, 'nov-last', {
      paidAt: '2026-11-30T23:59:59.000Z',
      taxCents: 800,
      amountCents: 4_900,
      refundedCents: 4_900,
      refundedAt: '2026-12-01T00:00:00.000Z',
    });
    await insertPurchase(growth.id, 'dec-first', { paidAt: '2026-12-01T00:00:00.000Z' });
    await insertPurchase(growth.id, 'pending', { paidAt: null, status: 'pending' });
    await insertPurchase(growth.id, 'nov-refund-partial', {
      paidAt: '2026-10-15T00:00:00.000Z',
      amountCents: 2_500,
      taxCents: 200,
      refundedCents: 1_000,
      refundedAt: '2026-11-30T23:59:59.000Z',
    });

    const november = await billingQueries.revenueForMonth('2026-11');
    expect(november.sales.map((s) => [s.amountCents, s.taxCents, s.paidAt.toISOString()])).toEqual([
      [9_900, 0, '2026-11-01T00:00:00.000Z'],
      [4_900, 800, '2026-11-30T23:59:59.000Z'],
    ]);
    expect(november.sales[0]?.purchaseId).toEqual(expect.any(String));
    expect(november.refunds).toEqual([
      {
        purchaseId: expect.any(String),
        refundedCents: 1_000,
        amountCents: 2_500,
        taxCents: 200,
        refundedAt: new Date('2026-11-30T23:59:59.000Z'),
      },
    ]);

    const december = await billingQueries.revenueForMonth('2026-12');
    expect(december.sales).toHaveLength(1);
    expect(december.sales[0]?.paidAt).toEqual(new Date('2026-12-01T00:00:00.000Z'));
    expect(december.refunds).toMatchObject([
      { refundedCents: 4_900, amountCents: 4_900, taxCents: 800 },
    ]);

    expect(await billingQueries.revenueForMonth('2027-01')).toEqual({ sales: [], refunds: [] });
    await expect(billingQueries.revenueForMonth('2026-13')).rejects.toThrow('Invalid month');
  });
});
