import { sql } from 'kysely';
import type { Database } from '../../../shared/infrastructure/db/database.js';
import { FIRST_TICKET_NUMBER } from '@app/contracts/support';
import { BUSINESS_A, BUSINESS_B, INTERNAL_BUSINESS, members, NOW } from './factories.js';

/**
 * MySQL fixtures for support's integration tests: empties support's tables (and the outbox),
 * resets the Ticket numbers to 1001 (TRUNCATE resets AUTO_INCREMENT to 1), and writes the
 * factories' Businesses and Members (support's foreign keys need them).
 */
const TABLES = [
  'support_ticket_views',
  'support_messages',
  'support_tickets',
  'outbox',
  'sessions',
  'members',
  'businesses',
];

export async function resetSupportWorld(db: Database): Promise<void> {
  await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
  for (const t of TABLES) await sql.raw(`TRUNCATE TABLE ${t}`).execute(db);
  await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);
  await sql
    .raw(`ALTER TABLE support_tickets AUTO_INCREMENT = ${String(FIRST_TICKET_NUMBER)}`)
    .execute(db);

  await db
    .insertInto('businesses')
    .values([
      { id: BUSINESS_A, name: 'Sweet Supply', created_at: NOW },
      { id: BUSINESS_B, name: 'Clean Desk', created_at: NOW },
      { id: INTERNAL_BUSINESS, name: 'Llyner', internal: true, created_at: NOW },
    ])
    .execute();
  await db
    .insertInto('members')
    .values(
      Object.values(members).map((m) => ({
        id: m.id,
        business_id: m.businessId,
        email: m.email,
        name: m.name,
        password_hash: 'x',
        role: m.role,
        is_staff: m.isStaff,
        email_verified_at: NOW,
        created_at: NOW,
      })),
    )
    .execute();
}
