import { describe, expect, test } from 'vitest';
import { CodedError, DomainRuleViolation, ValidationError } from '../../../shared/domain/errors.js';
import { CreditPack } from './credit-pack.js';
import { ledgerEntry } from './ledger-entry.js';
import { Purchase } from './purchase.js';
import { Reservation } from './reservation.js';
import { chargeableCredits, creditsFromMillicredits } from './settlement.js';
import { Wallet } from './wallet.js';

const now = new Date('2026-11-19T10:00:00.000Z');
const later = new Date('2026-11-19T11:00:00.000Z');

describe('FR-10: Credit wallet totals', () => {
  test('available = balance − reserved', () => {
    const wallet = Wallet.of({ businessId: 'b', balance: 1000, reserved: 400 });
    expect(wallet.available).toBe(600);
  });

  test('covering more than available throws INSUFFICIENT_CREDITS with { available, required }', () => {
    const wallet = Wallet.of({ businessId: 'b', balance: 300, reserved: 0 });
    try {
      wallet.assertCovers(400);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CodedError);
      expect((error as CodedError).code).toBe('INSUFFICIENT_CREDITS');
      expect((error as CodedError).details).toEqual({ available: 300, required: 400 });
    }
  });

  test('covering exactly available is allowed', () => {
    expect(() =>
      Wallet.of({ businessId: 'b', balance: 120, reserved: 0 }).assertCovers(120),
    ).not.toThrow();
  });

  test('credits are whole numbers', () => {
    expect(() => Wallet.of({ businessId: 'b', balance: 1.5, reserved: 0 })).toThrow(
      ValidationError,
    );
  });
});

describe('FR-20: Settlement math', () => {
  test('136,200 millicredits round up to 137 credits', () => {
    expect(creditsFromMillicredits(136_200)).toBe(137);
    expect(creditsFromMillicredits(137_000)).toBe(137);
    expect(creditsFromMillicredits(0)).toBe(0);
  });

  test('settling 137 from a 400 Reservation releases 263', () => {
    const reservation = Reservation.open({ runId: 'r', businessId: 'b', credits: 400, now });
    const credits = chargeableCredits({
      millicreditsSpent: 136_200,
      outcome: 'completed',
      leadsDelivered: 12,
    });
    expect(reservation.settle(credits, later)).toEqual({ charged: 137, released: 263 });
    expect(reservation.status).toBe('settled');
    expect(reservation.toSnapshot().closedAt).toEqual(later);
  });

  test('a failed run with 0 Leads is free; the full Reservation is released', () => {
    const reservation = Reservation.open({ runId: 'r', businessId: 'b', credits: 400, now });
    const credits = chargeableCredits({
      millicreditsSpent: 52_000,
      outcome: 'failed',
      leadsDelivered: 0,
    });
    expect(credits).toBe(0);
    expect(reservation.settle(credits, later)).toEqual({ charged: 0, released: 400 });
  });

  test('a failed run that delivered Leads pays the real cost; a cancelled run too', () => {
    expect(
      chargeableCredits({ millicreditsSpent: 52_001, outcome: 'failed', leadsDelivered: 1 }),
    ).toBe(53);
    expect(
      chargeableCredits({ millicreditsSpent: 9_000, outcome: 'cancelled', leadsDelivered: 0 }),
    ).toBe(9);
  });

  test('a Settlement never charges more than the hold', () => {
    const reservation = Reservation.open({ runId: 'r', businessId: 'b', credits: 400, now });
    expect(reservation.settle(450, later)).toEqual({ charged: 400, released: 0 });
  });

  test('rejects negative or fractional millicredits', () => {
    expect(() => creditsFromMillicredits(-1)).toThrow(ValidationError);
    expect(() => creditsFromMillicredits(1.5)).toThrow(ValidationError);
  });
});

describe('ADR 0009: Reservation lifecycle', () => {
  test('needs at least 1 whole credit', () => {
    expect(() => Reservation.open({ runId: 'r', businessId: 'b', credits: 0, now })).toThrow(
      ValidationError,
    );
  });

  test('release gives the whole hold back', () => {
    const reservation = Reservation.open({ runId: 'r', businessId: 'b', credits: 400, now });
    expect(reservation.release(later)).toEqual({ charged: 0, released: 400 });
    expect(reservation.status).toBe('released');
  });

  test('a closed Reservation cannot be settled or released again', () => {
    const reservation = Reservation.open({ runId: 'r', businessId: 'b', credits: 400, now });
    reservation.settle(10, later);
    expect(() => reservation.settle(10, later)).toThrow(DomainRuleViolation);
    expect(() => reservation.release(later)).toThrow(DomainRuleViolation);
  });

  test('FR-36: top-up extends an open hold and reopens a closed one for the remaining budget', () => {
    const open = Reservation.open({ runId: 'r', businessId: 'b', credits: 400, now });
    open.topUp(100);
    expect(open.credits).toBe(500);

    const closed = Reservation.open({ runId: 'r', businessId: 'b', credits: 400, now });
    closed.settle(0, later);
    closed.topUp(300);
    expect(closed.toSnapshot()).toMatchObject({ status: 'open', credits: 300, closedAt: null });
  });
});

describe('FR-10: Ledger entries', () => {
  const base = { id: 'e', businessId: 'b', createdAt: now };

  test('grants and purchases add, settlements remove, adjustments go either way', () => {
    expect(ledgerEntry({ ...base, type: 'grant', credits: 50, description: 'x' }).credits).toBe(50);
    expect(() => ledgerEntry({ ...base, type: 'grant', credits: -5, description: 'x' })).toThrow(
      ValidationError,
    );
    expect(() =>
      ledgerEntry({ ...base, type: 'settlement', credits: 5, description: 'x' }),
    ).toThrow(ValidationError);
    expect(
      ledgerEntry({ ...base, type: 'adjustment', credits: -5, description: 'x' }).credits,
    ).toBe(-5);
    expect(() =>
      ledgerEntry({ ...base, type: 'adjustment', credits: 0, description: 'x' }),
    ).toThrow(ValidationError);
  });

  test('description is 1 to 200 characters', () => {
    expect(() =>
      ledgerEntry({ ...base, type: 'adjustment', credits: 1, description: 'x'.repeat(201) }),
    ).toThrow(ValidationError);
    expect(() =>
      ledgerEntry({ ...base, type: 'adjustment', credits: 1, description: ' ' }),
    ).toThrow(ValidationError);
  });
});

describe('FR-13: Credit packs', () => {
  const valid = {
    id: 'p',
    position: 0,
    name: 'Starter',
    credits: 2500,
    priceCents: 2500,
    active: true,
  };

  test('accepts the seeded packs', () => {
    expect(CreditPack.create(valid).toSnapshot()).toEqual(valid);
  });

  test.each([
    ['name', { name: '' }],
    ['credits', { credits: 0 }],
    ['credits', { credits: 1_000_001 }],
    ['priceCents', { priceCents: 49 }],
    ['priceCents', { priceCents: 1_000_001 }],
  ])('rejects an invalid %s', (field, change) => {
    try {
      CreditPack.create({ ...valid, ...change });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toHaveProperty(field);
    }
  });

  test('change keeps the id and position', () => {
    const pack = CreditPack.create(valid);
    pack.change({ name: 'Starter+', credits: 3000, priceCents: 3000, active: false });
    expect(pack.toSnapshot()).toEqual({
      ...valid,
      name: 'Starter+',
      credits: 3000,
      priceCents: 3000,
      active: false,
    });
  });
});

describe('FR-12: Purchase', () => {
  test('is paid once; a repeated webhook changes nothing', () => {
    const purchase = Purchase.start({
      id: 'p',
      businessId: 'b',
      packId: 'k',
      credits: 2500,
      amountCents: 2500,
      stripeSessionId: 'cs_1',
      now,
    });
    expect(purchase.markPaid({ eventId: 'evt_1', taxCents: 200, now: later })).toBe(true);
    expect(purchase.markPaid({ eventId: 'evt_2', taxCents: 0, now: later })).toBe(false);
    expect(purchase.toSnapshot()).toMatchObject({
      status: 'paid',
      stripeEventId: 'evt_1',
      taxCents: 200,
      paidAt: later,
    });
  });

  test('a delayed payment that fails marks a pending purchase failed, never a paid one', () => {
    const start = (id: string) =>
      Purchase.start({
        id,
        businessId: 'b',
        packId: 'k',
        credits: 2500,
        amountCents: 2500,
        stripeSessionId: `cs_${id}`,
        now,
      });
    const pending = start('p1');
    expect(pending.markFailed()).toBe(true);
    expect(pending.status).toBe('failed');
    expect(pending.markFailed()).toBe(false);
    const paid = start('p2');
    paid.markPaid({ eventId: 'evt_1', taxCents: 0, now: later });
    expect(paid.markFailed()).toBe(false);
    expect(paid.status).toBe('paid');
  });
});

describe('FR-7: Purchase refunds', () => {
  const paidPurchase = () => {
    const purchase = Purchase.start({
      id: 'p',
      businessId: 'b',
      packId: 'k',
      credits: 11_000,
      amountCents: 9_900,
      stripeSessionId: 'cs_1',
      now,
    });
    purchase.markPaid({ eventId: 'evt_1', taxCents: 0, now: later, paymentIntentId: 'pi_1' });
    return purchase;
  };
  const refundTime = new Date('2026-12-03T09:00:00.000Z');

  test('payment intent is kept when paid; none by default', () => {
    expect(paidPurchase().toSnapshot().stripePaymentIntentId).toBe('pi_1');
    const bare = Purchase.start({
      id: 'p2',
      businessId: 'b',
      packId: 'k',
      credits: 1,
      amountCents: 1,
      stripeSessionId: 'cs_2',
      now,
    });
    bare.markPaid({ eventId: 'e', taxCents: 0, now: later });
    expect(bare.toSnapshot().stripePaymentIntentId).toBeNull();
  });

  test('a refund sets the cumulative amount and time', () => {
    const purchase = paidPurchase();
    expect(purchase.recordRefund({ refundedCents: 9_900, now: refundTime })).toBe(9_900);
    expect(purchase.toSnapshot()).toMatchObject({ refundedCents: 9_900, refundedAt: refundTime });
  });

  test('the same or an older cumulative amount changes nothing; it never decreases', () => {
    const purchase = paidPurchase();
    purchase.recordRefund({ refundedCents: 4_000, now: refundTime });
    const later2 = new Date('2026-12-04T09:00:00.000Z');
    expect(purchase.recordRefund({ refundedCents: 4_000, now: later2 })).toBe(0);
    expect(purchase.recordRefund({ refundedCents: 1_000, now: later2 })).toBe(0);
    expect(purchase.toSnapshot()).toMatchObject({ refundedCents: 4_000, refundedAt: refundTime });
    expect(purchase.recordRefund({ refundedCents: 9_900, now: later2 })).toBe(5_900);
    expect(purchase.toSnapshot()).toMatchObject({ refundedCents: 9_900, refundedAt: later2 });
  });

  test('a purchase that is not paid cannot be refunded', () => {
    const pending = Purchase.start({
      id: 'p3',
      businessId: 'b',
      packId: 'k',
      credits: 1,
      amountCents: 1,
      stripeSessionId: 'cs_3',
      now,
    });
    expect(pending.recordRefund({ refundedCents: 1, now: refundTime })).toBe(0);
    expect(pending.refundedCents).toBe(0);
  });
});
