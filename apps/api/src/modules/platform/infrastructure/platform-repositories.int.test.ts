import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { KyselyUnitOfWork } from '../../../shared/infrastructure/db/unit-of-work.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import type { SettingsRepos } from '../application/settings-use-cases.js';
import { GetSettings, UpdateSettingsSection } from '../application/settings-use-cases.js';
import { CachedSettingsReader } from '../application/settings-reader.js';
import { auditLogRepositoryContract } from '../test/audit-log-repository-contract.js';
import { staffActor } from '../test/fakes.js';
import { DbAnalyticsTracker } from './db-analytics-tracker.js';
import { KyselyAuditLogRepository } from './kysely-audit-log-repository.js';
import { KyselySettingsRepository } from './kysely-settings-repository.js';
import { AesGcmSecretBox } from './secret-box.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const box = new AesGcmSecretBox(Buffer.alloc(32, 5));
const clock = new FixedClock(new Date('2026-11-19T10:00:00.000Z'));

async function truncate(): Promise<void> {
  await sql`SET FOREIGN_KEY_CHECKS=0`.execute(db);
  for (const table of ['settings', 'audit_log', 'analytics_events']) {
    await sql`TRUNCATE TABLE ${sql.table(table)}`.execute(db);
  }
  await sql`SET FOREIGN_KEY_CHECKS=1`.execute(db);
}

beforeEach(truncate);
afterAll(async () => {
  await db.destroy();
});

auditLogRepositoryContract('kysely', () => new KyselyAuditLogRepository(db));

function settingsStack() {
  const repository = new KyselySettingsRepository(db);
  const reader = new CachedSettingsReader({ repository, secretBox: box, clock });
  const uow = new KyselyUnitOfWork<SettingsRepos>(db, (trx) => ({
    settings: new KyselySettingsRepository(trx),
    auditLog: new KyselyAuditLogRepository(trx),
  }));
  const update = new UpdateSettingsSection({
    uow,
    secretBox: box,
    reader,
    clock,
    ids: new SequentialIdGenerator(),
  });
  return { repository, reader, update, get: new GetSettings({ repository }) };
}

describe('FR-8: settings in MySQL', () => {
  test('an SMTP password is ciphertext in the DB and only last4 comes back', async () => {
    const { update, get, reader } = settingsStack();
    await update.execute({
      actor: staffActor(),
      section: 'email',
      input: {
        host: 'mailpit',
        port: 1025,
        username: 'user',
        password: 'smtp-pass-word-a1f3',
        tls: 'none',
        fromName: 'Llyner Leads',
        fromAddress: 'hello@llyner.test',
        replyTo: null,
      },
    });
    const row = await db
      .selectFrom('settings')
      .selectAll()
      .where('section', '=', 'email')
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(row)).not.toContain('smtp-pass-word');
    const sealed = row.secrets_enc?.password;
    expect(sealed?.ciphertext).toBeTruthy();
    expect(sealed?.last4).toBe('a1f3');
    expect(row.value_json).toEqual({
      host: 'mailpit',
      port: 1025,
      username: 'user',
      tls: 'none',
      fromName: 'Llyner Leads',
      fromAddress: 'hello@llyner.test',
      replyTo: null,
    });

    const settings = await get.execute({ actor: staffActor() });
    expect(settings.email.password).toEqual({
      set: true,
      last4: 'a1f3',
      updatedAt: '2026-11-19T10:00:00.000Z',
    });
    expect((await reader.email()).password).toBe('smtp-pass-word-a1f3');
  });

  test('FR-7: the save and its Audit log entry are written together', async () => {
    const { update } = settingsStack();
    await update.execute({
      actor: staffActor(),
      section: 'ai',
      input: {
        anthropicApiKey: 'sk-ant-api03-abcdef',
        planningModel: 'claude-opus-5-5',
        chatModel: 'claude-sonnet-5-5',
        fastModel: 'claude-haiku-5-5',
      },
    });
    const entries = await db.selectFrom('audit_log').selectAll().execute();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'settings.ai.updated',
      target_type: 'settings',
      target_id: 'ai',
      details: { fields: ['anthropicApiKey'] },
    });
    expect(JSON.stringify(entries)).not.toContain('sk-ant-api03');
  });

  test('saving again updates the row in place', async () => {
    const { update, repository } = settingsStack();
    const actor = staffActor();
    await update.execute({ actor, section: 'landing', input: { youtubeVideoId: 'dQw4w9WgXcQ' } });
    await update.execute({ actor, section: 'landing', input: { youtubeVideoId: null } });
    const all = await repository.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.values).toEqual({ youtubeVideoId: null });
  });
});

describe('FR-9: DbAnalyticsTracker', () => {
  test('writes the event with ids and safe properties only', async () => {
    const tracker = new DbAnalyticsTracker({ db, clock, ids: new SequentialIdGenerator() });
    await tracker.track({
      name: 'run_started',
      actor: { memberId: staffActor().memberId, businessId: staffActor().businessId },
      properties: { run_id: 'r1', credits_reserved: 100, email: 'owner@demo.test' },
    });
    const rows = await db.selectFrom('analytics_events').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'run_started',
      business_id: staffActor().businessId,
      member_id: staffActor().memberId,
      properties: { run_id: 'r1', credits_reserved: 100 },
      at: new Date('2026-11-19T10:00:00.000Z'),
    });
  });

  test('a failed insert is reported, not thrown', async () => {
    const errors: string[] = [];
    const tracker = new DbAnalyticsTracker({
      db,
      clock,
      ids: { next: () => 'x'.repeat(100) },
      onError: (_err, event) => errors.push(event.name),
    });
    await expect(tracker.track({ name: 'plan_created' })).resolves.toBeUndefined();
    expect(errors).toEqual(['plan_created']);
  });
});
