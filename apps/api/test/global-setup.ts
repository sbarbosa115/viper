import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { createDatabase } from '../src/shared/infrastructure/db/database.js';

/** Runs all migrations once against the test database; refuses anything not named *_test. */
export default async function setup(): Promise<() => Promise<void>> {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set');
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to run integration tests against "${dbName}": name must end in _test`,
    );
  }

  const db = createDatabase(url);
  const migrationFolder = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../migrations',
  );
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({ fs, path, migrationFolder }),
    allowUnorderedMigrations: true,
  });
  const { error } = await migrator.migrateToLatest();
  if (error) {
    await db.destroy();
    throw new Error('Migrations failed', { cause: error });
  }
  return async () => {
    await db.destroy();
  };
}
