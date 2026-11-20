import { Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';
import type { DB } from './schema.js';

export type Database = Kysely<DB>;

export function createDatabase(databaseUrl: string): Database {
  const pool = createPool({
    uri: databaseUrl,
    timezone: 'Z',
    charset: 'utf8mb4',
    connectionLimit: 10,
    dateStrings: false,
    decimalNumbers: true,
  });
  return new Kysely<DB>({ dialect: new MysqlDialect({ pool }) });
}
