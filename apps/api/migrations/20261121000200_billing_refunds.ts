import { sql, type Kysely } from 'kysely';

/**
 * billing: refunds from Stripe's `charge.refunded` reverse revenue (prd-expenses FR-7). A paid
 * purchase stores its Checkout Session's payment intent so the refund can find it;
 * `refunded_cents` is the charge's cumulative `amount_refunded`. Purchases paid before this
 * release keep a null payment intent.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `ALTER TABLE purchases
        ADD COLUMN stripe_payment_intent_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER stripe_event_id,
        ADD COLUMN refunded_cents INT NOT NULL DEFAULT 0 AFTER tax_cents,
        ADD COLUMN refunded_at DATETIME(3) NULL AFTER paid_at,
        ADD UNIQUE KEY purchases_stripe_payment_intent_id (stripe_payment_intent_id),
        ADD KEY purchases_refunded_at (refunded_at)`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `ALTER TABLE purchases
        DROP INDEX purchases_refunded_at,
        DROP INDEX purchases_stripe_payment_intent_id,
        DROP COLUMN refunded_at,
        DROP COLUMN refunded_cents,
        DROP COLUMN stripe_payment_intent_id`,
    )
    .execute(db);
}
