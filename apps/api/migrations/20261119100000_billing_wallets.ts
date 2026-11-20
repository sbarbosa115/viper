import { sql, type Kysely } from 'kysely';

/**
 * billing: one lock row per Business's Credit wallet. Every write to a Business's ledger or
 * Reservations locks this row first (SELECT … FOR UPDATE semantics), so concurrent reserves
 * can't overspend (ADR 0009). The balance itself stays derived from the ledger.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `CREATE TABLE credit_wallets (
        business_id CHAR(36) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (business_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw('DROP TABLE IF EXISTS credit_wallets').execute(db);
}
