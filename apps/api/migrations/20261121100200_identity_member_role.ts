import { sql, type Kysely } from 'kysely';

/**
 * identity: a Business can have Members who are not its Owner (prd-support section 9). Only the
 * seed creates them until team invites ship.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(`ALTER TABLE members MODIFY role ENUM('owner','member') NOT NULL DEFAULT 'owner'`)
    .execute(db);
}

/** Non-Owner Members become Owners again: the old column can't hold `member`. */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`UPDATE members SET role = 'owner' WHERE role = 'member'`).execute(db);
  await sql
    .raw(`ALTER TABLE members MODIFY role ENUM('owner') NOT NULL DEFAULT 'owner'`)
    .execute(db);
}
