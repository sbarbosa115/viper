import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { FileMigrationProvider, Migrator, NO_MIGRATIONS } from 'kysely/migration';
import { afterAll, describe, expect, test } from 'vitest';
import { createDatabase } from '../shared/infrastructure/db/database.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const migrationFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);
const migrator = new Migrator({
  db,
  provider: new FileMigrationProvider({ fs, path, migrationFolder }),
  allowUnorderedMigrations: true,
});

afterAll(async () => {
  await db.destroy();
});

/** Every table in PRD section 8 (the Removal list is deferred). */
const prdTables = [
  'expenses',
  'expense_prices',
  'provider_invoices',
  'finance_budgets',
  'finance_settings',
  'budget_alerts',
  'credit_wallets',
  'businesses',
  'members',
  'sessions',
  'email_tokens',
  'login_attempts',
  'settings',
  'audit_log',
  'analytics_events',
  'outbox',
  'credit_ledger',
  'reservations',
  'credit_packs',
  'purchases',
  'business_profiles',
  'products',
  'conversations',
  'messages',
  'plans',
  'target_segments',
  'research_flows',
  'research_runs',
  'run_steps',
  'run_attempts',
  'run_handoffs',
  'run_messages',
  'research_run_emails',
  'tools',
  'tool_calls',
  'sources',
  'prospects',
  'leads',
  'lead_contacts',
  'lead_evidence',
];

async function tables(): Promise<{ name: string; engine: string; collation: string }[]> {
  const { rows } = await sql<{ name: string; engine: string; collation: string }>`
    SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_COLLATION AS collation
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME NOT LIKE 'kysely_%'`.execute(db);
  return rows;
}

async function uniqueKeys(table: string): Promise<string[]> {
  const { rows } = await sql<{ name: string; columns: string }>`
    SELECT INDEX_NAME AS name, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table} AND NON_UNIQUE = 0
    GROUP BY INDEX_NAME`.execute(db);
  return rows.map((r) => r.columns);
}

describe('migrations: PRD section 8 schema', () => {
  test('every section 8 table exists, InnoDB, utf8mb4', async () => {
    const found = await tables();
    expect(found.map((t) => t.name).sort()).toEqual([...prdTables].sort());
    for (const t of found) {
      expect(t.engine).toBe('InnoDB');
      expect(t.collation).toMatch(/^utf8mb4_/);
    }
  });

  test('the unique keys from section 8 exist', async () => {
    expect(await uniqueKeys('members')).toContain('email');
    expect(await uniqueKeys('email_tokens')).toContain('token_hash');
    expect(await uniqueKeys('credit_ledger')).toContain('idempotency_key');
    expect(await uniqueKeys('purchases')).toContain('stripe_payment_intent_id');
    expect(await uniqueKeys('expense_prices')).toContain('expense_id,effective_from');
    expect(await uniqueKeys('purchases')).toEqual(
      expect.arrayContaining(['stripe_session_id', 'stripe_event_id']),
    );
    expect(await uniqueKeys('research_flows')).toContain('key,version');
    expect(await uniqueKeys('run_attempts')).toContain('run_id,n');
    expect(await uniqueKeys('run_steps')).toContain('run_id,step_key');
    expect(await uniqueKeys('leads')).toContain('plan_id,place_key');
  });

  test('every column ending in _id is indexed (foreign keys and filters; audit_log.target_id is polymorphic)', async () => {
    const { rows } = await sql<{ table: string; column: string }>`
      SELECT c.TABLE_NAME AS \`table\`, c.COLUMN_NAME AS \`column\`
      FROM information_schema.COLUMNS c
      WHERE c.TABLE_SCHEMA = DATABASE() AND c.COLUMN_NAME LIKE '%\\_id'
        AND c.TABLE_NAME NOT LIKE 'kysely_%'
        AND NOT (c.TABLE_NAME = 'audit_log' AND c.COLUMN_NAME = 'target_id')
        AND NOT EXISTS (
          SELECT 1 FROM information_schema.STATISTICS s
          WHERE s.TABLE_SCHEMA = c.TABLE_SCHEMA AND s.TABLE_NAME = c.TABLE_NAME
            AND s.COLUMN_NAME = c.COLUMN_NAME AND s.SEQ_IN_INDEX = 1)`.execute(db);
    expect(rows).toEqual([]);
  });

  test('times are DATETIME(3) and the leads place key compares case-sensitively', async () => {
    const { rows } = await sql<{ type: string }>`
      SELECT DISTINCT COLUMN_TYPE AS type FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE = 'datetime'`.execute(db);
    expect(rows.map((r) => r.type)).toEqual(['datetime(3)']);
    await db.connection().execute(async (conn) => {
      const lead = (id: string, placeKey: string) =>
        sql`
          INSERT INTO leads (id, business_id, plan_id, run_id, prospect_id, place_key, name,
            fit_score, pitch_product_name, pitch_reason, delivered_at)
          VALUES (${id}, 'b', 'p', 'r', 'x', ${placeKey}, 'n', 80, 'sugar', 'why', NOW(3))`.execute(
          conn,
        );
      await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(conn);
      try {
        await lead('1', 'google:ChIJabc');
        await lead('2', 'google:ChIJABC');
        await expect(lead('3', 'google:ChIJabc')).rejects.toThrow(/Duplicate/);
      } finally {
        await sql`TRUNCATE TABLE leads`.execute(conn);
        await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(conn);
      }
    });
  });

  test('migrations roll all the way down and back up', async () => {
    const down = await migrator.migrateTo(NO_MIGRATIONS);
    expect(down.error).toBeUndefined();
    expect(await tables()).toEqual([]);
    const up = await migrator.migrateToLatest();
    expect(up.error).toBeUndefined();
    expect((await tables()).length).toBe(prdTables.length);
  });
});
