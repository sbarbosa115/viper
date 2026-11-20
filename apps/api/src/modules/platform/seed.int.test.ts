import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { createDatabase } from '../../shared/infrastructure/db/database.js';
import { FixedClock } from '../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../shared/infrastructure/time/uuid7.js';
import { createSecretBox, createSettingsReader, seed } from './index.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const config = { NODE_ENV: 'test' as const };
const deps = () => ({
  db,
  config,
  clock: new FixedClock(new Date('2026-11-19T10:00:00.000Z')),
  ids: new SequentialIdGenerator(),
  demo: {
    members: { staff: '00000000-0000-7000-8000-00000000d104' },
    businesses: { llynerInternal: '00000000-0000-7000-8000-00000000d004' },
  },
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE settings`.execute(db);
  await sql`TRUNCATE TABLE audit_log`.execute(db);
});
afterAll(async () => {
  await db.destroy();
});

describe('PRD 8a: platform demo seed', () => {
  test('SMTP → Mailpit without TLS, fake provider keys sealed, default ceilings', async () => {
    await seed(deps());
    const reader = createSettingsReader({
      db,
      secretBox: createSecretBox(config),
      clock: new FixedClock(new Date('2026-11-19T10:00:00.000Z')),
    });
    expect(await reader.email()).toMatchObject({ host: 'mailpit', port: 1025, tls: 'none' });
    expect((await reader.provider('apify')).apiKey).toMatch(/fake/);
    expect((await reader.provider('twilio')).authToken).toMatch(/fake/);
    expect((await reader.ai()).planningModel).toBe('claude-opus-5-5');
    expect((await reader.ceilings()).trialCredits).toBe(50);
    const rows = await db.selectFrom('settings').selectAll().execute();
    expect(rows).toHaveLength(8);
    expect(JSON.stringify(rows)).not.toContain('fake-dev');
  });

  test('is idempotent and keeps sections already saved', async () => {
    await seed(deps());
    await seed(deps());
    expect(await db.selectFrom('settings').selectAll().execute()).toHaveLength(8);
    expect(await db.selectFrom('audit_log').selectAll().execute()).toHaveLength(8);
  });
});
