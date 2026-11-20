import { sql, type Kysely } from 'kysely';

/**
 * billing: a purchase paid with a method that settles later can fail
 * (`checkout.session.async_payment_failed`, FR-12). Adds `failed` to `purchases.status`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(`ALTER TABLE purchases MODIFY COLUMN status ENUM('pending','paid','failed') NOT NULL`)
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`UPDATE purchases SET status = 'pending' WHERE status = 'failed'`).execute(db);
  await sql
    .raw(`ALTER TABLE purchases MODIFY COLUMN status ENUM('pending','paid') NOT NULL`)
    .execute(db);
}
