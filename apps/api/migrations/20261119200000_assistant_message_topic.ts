import { sql, type Kysely } from 'kysely';

/**
 * assistant: the topic each assistant message asked about (products, location, radius, goal…),
 * so the welcome chat knows which optional questions were already asked (FR-14).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw('ALTER TABLE messages ADD COLUMN topic VARCHAR(32) NULL AFTER quick_replies')
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw('ALTER TABLE messages DROP COLUMN topic').execute(db);
}
