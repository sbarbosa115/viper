import { Redis } from 'ioredis';
import { sql } from 'kysely';
import { pino } from 'pino';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildTestApp, testConfig } from '../test/build-test-app.js';
import { composeModules } from './composition.js';
import { LOCAL_BUYERS_V1 } from './modules/research/index.js';
import { ALL_TOOL_KEYS, seed as seedTools } from './modules/tools/index.js';
import type { Actor } from './shared/domain/actor.js';
import { createDatabase } from './shared/infrastructure/db/database.js';
import { SystemClock } from './shared/infrastructure/time/system-clock.js';

/**
 * FR-7: research's flow saves and tools' Rate card changes write their Audit log entry through
 * platform's Audit log, wired by the composition root, inside the caller's transaction. If the
 * entry can't be written, the change rolls back with it.
 */
const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});
const modules = composeModules(
  {
    ...testConfig,
    DATABASE_URL: process.env.DATABASE_URL_TEST ?? '',
    REDIS_URL: process.env.REDIS_URL ?? '',
  },
  { db, logger: pino({ level: 'silent' }), redis },
);

const STAFF_ID = '00000000-0000-7000-8000-00000000c0a1';
const staff: Actor = {
  memberId: STAFF_ID,
  businessId: '00000000-0000-7000-8000-00000000b0a1',
  roles: ['owner', 'staff'],
  emailVerified: true,
};

beforeEach(async () => {
  await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
  for (const t of ['research_flows', 'audit_log', 'tools']) {
    await sql.raw(`TRUNCATE TABLE ${t}`).execute(db);
  }
  await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);
  await modules.research.flows.ensureTemplate(LOCAL_BUYERS_V1, true);
  await seedTools({ db, clock: new SystemClock() });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  redis.disconnect();
  modules.email.close();
  await db.destroy();
});

/** Makes every Audit log insert fail (the table is missing) for the duration of `fn`. */
async function withAuditLogBroken<T>(fn: () => Promise<T>): Promise<T> {
  await sql`RENAME TABLE audit_log TO audit_log_parked`.execute(db);
  try {
    return await fn();
  } finally {
    await sql`RENAME TABLE audit_log_parked TO audit_log`.execute(db);
  }
}

/**
 * The real Audit log write goes through, then the save fails after it. The entry is gone only
 * if it was written in the caller's transaction (`within`), not on its own connection.
 */
function failAfterAuditWrite(): void {
  const audit = modules.core.auditLog;
  const record = audit.record.bind(audit);
  vi.spyOn(audit, 'record').mockImplementation(async (entry, within) => {
    await record(entry, within);
    throw new Error('the save fails after its Audit log entry');
  });
}

const auditActions = async () =>
  (await db.selectFrom('audit_log').select('action').execute()).map((r) => r.action);

function nextFlowInput() {
  const { version: _version, ...rest } = LOCAL_BUYERS_V1;
  return { ...rest, runSettings: { ...rest.runSettings, maxAttempts: 2 } } as never;
}

describe('FR-7: Audit log entries commit with the change they describe', () => {
  test('a research flow save writes its entry', async () => {
    await modules.research.flows.update(staff, LOCAL_BUYERS_V1.key, nextFlowInput());
    expect((await modules.research.flows.get(staff, LOCAL_BUYERS_V1.key)).version).toBe(2);
    expect(await auditActions()).toEqual(['research_flow.updated']);
  });

  test('a failing Audit log write rolls back the research flow save', async () => {
    await withAuditLogBroken(() =>
      expect(
        modules.research.flows.update(staff, LOCAL_BUYERS_V1.key, nextFlowInput()),
      ).rejects.toThrow(),
    );
    expect((await modules.research.flows.get(staff, LOCAL_BUYERS_V1.key)).version).toBe(1);
    const versions = await db.selectFrom('research_flows').select('version').execute();
    expect(versions.map((v) => v.version)).toEqual([1]);
    expect(await auditActions()).toEqual([]);
  });

  test("the flow save's entry is written in its transaction: it rolls back with the save", async () => {
    failAfterAuditWrite();
    await expect(
      modules.research.flows.update(staff, LOCAL_BUYERS_V1.key, nextFlowInput()),
    ).rejects.toThrow('the save fails after its Audit log entry');
    vi.restoreAllMocks();
    expect((await modules.research.flows.get(staff, LOCAL_BUYERS_V1.key)).version).toBe(1);
    expect(await auditActions()).toEqual([]);
  });

  test("the Rate card change's entry is written in its transaction: it rolls back with the change", async () => {
    const key = ALL_TOOL_KEYS[0] ?? '';
    const app = await buildTestApp({ modules: [modules.tools.module], actor: staff });
    failAfterAuditWrite();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/staff/tools/${key}`,
      payload: { creditsPerUnit: 123 },
    });
    expect(res.statusCode).toBe(500);
    const row = await db
      .selectFrom('tools')
      .select('credits_per_unit')
      .where('key', '=', key)
      .executeTakeFirstOrThrow();
    expect(Number(row.credits_per_unit)).not.toBe(123);
    expect(await auditActions()).toEqual([]);
    await app.close();
  });

  test('a Rate card change writes its entry; a failing Audit log write rolls it back', async () => {
    const key = ALL_TOOL_KEYS[0] ?? '';
    const app = await buildTestApp({ modules: [modules.tools.module], actor: staff });
    const before = await db
      .selectFrom('tools')
      .select('credits_per_unit')
      .where('key', '=', key)
      .executeTakeFirstOrThrow();
    const patch = (creditsPerUnit: number) =>
      app.inject({ method: 'PATCH', url: `/api/staff/tools/${key}`, payload: { creditsPerUnit } });

    const failed = await withAuditLogBroken(() => patch(Number(before.credits_per_unit) + 1));
    expect(failed.statusCode).toBe(500);
    const unchanged = await db
      .selectFrom('tools')
      .select('credits_per_unit')
      .where('key', '=', key)
      .executeTakeFirstOrThrow();
    expect(Number(unchanged.credits_per_unit)).toBe(Number(before.credits_per_unit));
    expect(await auditActions()).toEqual([]);

    const ok = await patch(Number(before.credits_per_unit) + 2);
    expect(ok.statusCode).toBe(200);
    expect(await auditActions()).toEqual(['tool.updated']);
    await app.close();
  });
});
