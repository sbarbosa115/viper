import { describe, expect, test } from 'vitest';
import {
  createCheckout,
  createCreditPack,
  getCredits,
  grantCredits,
  listCreditPacks,
  listLedger,
  stripeWebhook,
  updateCreditPack,
} from './billing.js';
import * as ex from './examples.js';

describe('contracts: billing', () => {
  test('FR-10: wallet', () => {
    expect(getCredits.response.safeParse(ex.creditWallet).success).toBe(true);
    expect(getCredits.response.safeParse({ ...ex.creditWallet, reserved: -1 }).success).toBe(false);
  });

  test('FR-10: ledger page of 25 with signed credits', () => {
    expect(listLedger.query.parse({}).limit).toBe(25);
    expect(listLedger.query.parse({ limit: '10' }).limit).toBe(10);
    expect(listLedger.query.safeParse({ limit: '101' }).success).toBe(false);
    expect(
      listLedger.response.safeParse({ items: [ex.ledgerEntry], nextCursor: 'c' }).success,
    ).toBe(true);
    expect(
      listLedger.response.safeParse({
        items: [{ ...ex.ledgerEntry, type: 'refund' }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });

  test('FR-12: checkout and webhook', () => {
    expect(createCheckout.body.safeParse({ packId: ex.ids.pack }).success).toBe(true);
    expect(createCheckout.body.safeParse({}).success).toBe(false);
    expect(
      createCheckout.response.safeParse({ checkoutUrl: 'https://checkout.stripe.com/c/1' }).success,
    ).toBe(true);
    expect(createCheckout.response.safeParse({ checkoutUrl: 'nope' }).success).toBe(false);
    expect(createCheckout.errors).toContainEqual({ status: 503, code: 'PAYMENTS_UNAVAILABLE' });
    expect(stripeWebhook.rawBody).toBe(true);
    expect(stripeWebhook.response.safeParse({ received: true }).success).toBe(true);
    expect(stripeWebhook.response.safeParse({ received: false }).success).toBe(false);
  });

  test('FR-13: grants are non-zero, within ±1,000,000, with a reason', () => {
    expect(grantCredits.body.safeParse({ credits: 1000, reason: 'beta tester' }).success).toBe(
      true,
    );
    expect(grantCredits.body.safeParse({ credits: -50, reason: 'mistake' }).success).toBe(true);
    expect(grantCredits.body.safeParse({ credits: 0, reason: 'x' }).success).toBe(false);
    expect(grantCredits.body.safeParse({ credits: 1_000_001, reason: 'x' }).success).toBe(false);
    expect(grantCredits.body.safeParse({ credits: 5, reason: '' }).success).toBe(false);
    expect(grantCredits.response.safeParse({ ...ex.ledgerEntry, type: 'adjustment' }).success).toBe(
      true,
    );
  });

  test('FR-13: credit packs', () => {
    const input = { name: 'Starter', credits: 2500, priceCents: 2500, active: true };
    expect(createCreditPack.body.safeParse(input).success).toBe(true);
    expect(createCreditPack.body.safeParse({ ...input, priceCents: 49 }).success).toBe(false);
    expect(updateCreditPack.body.safeParse({ ...input, credits: 0 }).success).toBe(false);
    expect(
      listCreditPacks.response.safeParse({ items: [ex.creditPack], nextCursor: null }).success,
    ).toBe(true);
    expect(createCreditPack.response.safeParse({ ...ex.creditPack, id: undefined }).success).toBe(
      false,
    );
  });
});
