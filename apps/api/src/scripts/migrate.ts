import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { loadConfig } from '../config/env.js';
import { createDatabase } from '../shared/infrastructure/db/database.js';

const direction = process.argv[2] === 'down' ? 'down' : 'up';
const config = loadConfig({
  ...process.env,
  DATABASE_URL:
    process.env.DATABASE_URL_TEST && process.env.NODE_ENV === 'test'
      ? process.env.DATABASE_URL_TEST
      : process.env.DATABASE_URL,
});
const db = createDatabase(config.DATABASE_URL);

// Source: apps/api/src/scripts -> ../../migrations. Bundled: dist/scripts -> ../migrations.
const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [path.resolve(here, '../../migrations'), path.resolve(here, '../migrations')];
const migrationFolder = (
  await Promise.all(
    candidates.map(async (c) => ((await fs.stat(c).catch(() => null))?.isDirectory() ? c : null)),
  )
).find((c) => c !== null);
if (!migrationFolder) throw new Error('migrations folder not found');

const migrator = new Migrator({
  db,
  provider: new FileMigrationProvider({ fs, path, migrationFolder }),
  allowUnorderedMigrations: true,
});

const { error, results } = await (direction === 'down'
  ? migrator.migrateDown()
  : migrator.migrateToLatest());
for (const r of results ?? []) {
  console.log(`${r.status}: ${r.migrationName} (${r.direction})`);
}
if (!results?.length) console.log('no migrations to run');
await db.destroy();
if (error) {
  console.error('migration failed', error);
  process.exit(1);
}
