import { Kysely, MysqlDialect } from 'kysely';
import { createPool, type SslOptions } from 'mysql2';
import type { DB } from './schema.js';

export type Database = Kysely<DB>;

const SSL_MODES: Record<string, SslOptions | undefined> = {
  DISABLED: undefined,
  PREFERRED: { rejectUnauthorized: false },
  REQUIRED: { rejectUnauthorized: false },
  VERIFY_CA: { rejectUnauthorized: true },
  VERIFY_IDENTITY: { rejectUnauthorized: true },
};

/**
 * mysql2 options for a database URL. Managed MySQL URLs (DigitalOcean's among them) carry the
 * MySQL client's `ssl-mode`, which mysql2 doesn't know: it logs a warning and drops it. The
 * parameter is taken out of the URL and mapped to mysql2's `ssl`, unless the URL already has an
 * explicit mysql2 `ssl` parameter, which wins. Other parameters are kept as written.
 */
export function connectionOptions(databaseUrl: string): { uri: string; ssl?: SslOptions } {
  const [base = '', query] = databaseUrl.split('?', 2);
  if (query === undefined) return { uri: databaseUrl };
  const params = query.split('&');
  const modeParam = params.find((p) => p.startsWith('ssl-mode='));
  if (!modeParam) return { uri: databaseUrl };
  const rest = params.filter((p) => p !== modeParam);
  const uri = rest.length > 0 ? `${base}?${rest.join('&')}` : base;
  const mode = decodeURIComponent(modeParam.slice('ssl-mode='.length)).toUpperCase();
  if (!(mode in SSL_MODES)) throw new Error(`Unknown ssl-mode in DATABASE_URL: ${mode}`);
  const ssl = SSL_MODES[mode];
  if (ssl === undefined || rest.some((p) => p.startsWith('ssl='))) return { uri };
  return { uri, ssl };
}

export function createDatabase(databaseUrl: string): Database {
  const pool = createPool({
    ...connectionOptions(databaseUrl),
    timezone: 'Z',
    charset: 'utf8mb4',
    connectionLimit: 10,
    dateStrings: false,
    decimalNumbers: true,
  });
  return new Kysely<DB>({ dialect: new MysqlDialect({ pool }) });
}
