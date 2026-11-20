import { sql } from 'kysely';
import { afterAll, describe, expect, test } from 'vitest';
import { createDatabase } from './database.js';
import { KyselyUnitOfWork } from './unit-of-work.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');

afterAll(async () => {
  await db.destroy();
});

describe('shared kernel: database', () => {
  test('connects to MySQL and stores times as UTC', async () => {
    const { rows } = await sql<{
      one: number;
      tz: string;
    }>`SELECT 1 AS one, @@session.time_zone AS tz`.execute(db);
    expect(rows[0]?.one).toBe(1);
  });

  test('UnitOfWork runs the work inside a transaction', async () => {
    const uow = new KyselyUnitOfWork(db, (trx) => ({ trx }));
    const connectionIds = await uow.run(async ({ trx }) => {
      const a = await sql<{ id: number }>`SELECT CONNECTION_ID() AS id`.execute(trx);
      const b = await sql<{ id: number }>`SELECT CONNECTION_ID() AS id`.execute(trx);
      return [a.rows[0]?.id, b.rows[0]?.id];
    });
    expect(connectionIds[0]).toBe(connectionIds[1]);
  });
});
