import { sql, type Kysely } from 'kysely';

/**
 * billing: each `charge.refunded` that raises a purchase's cumulative refund becomes one row, so a
 * refund counts in the month it happened and a closed month never changes (prd-expenses FR-7).
 * `purchases.refunded_cents` and `refunded_at` stay as the cumulative summary. Refunds recorded
 * before this release become one backfilled row each (their whole cumulative amount).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `CREATE TABLE purchase_refunds (
        id CHAR(36) NOT NULL,
        purchase_id CHAR(36) NOT NULL,
        stripe_event_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        delta_cents INT NOT NULL COMMENT 'the increase of the cumulative refunded amount',
        refunded_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY purchase_refunds_stripe_event_id (stripe_event_id),
        KEY purchase_refunds_refunded_at (refunded_at),
        KEY purchase_refunds_purchase_id (purchase_id),
        CONSTRAINT purchase_refunds_purchase_fk FOREIGN KEY (purchase_id) REFERENCES purchases (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    )
    .execute(db);
  await sql
    .raw(
      `INSERT INTO purchase_refunds (id, purchase_id, stripe_event_id, delta_cents, refunded_at)
       SELECT UUID(), id, CONCAT('backfill:', id), refunded_cents, refunded_at
       FROM purchases WHERE refunded_cents > 0 AND refunded_at IS NOT NULL`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw('DROP TABLE purchase_refunds').execute(db);
}
