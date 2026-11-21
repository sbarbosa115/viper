import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import type { ToolCallRecord } from '../application/ports.js';
import { ToolRunner } from '../application/tool-runner.js';
import { adapterRegistry } from '../application/tool-adapter.js';
import { TOOL_CATALOG } from '../domain/catalog.js';
import {
  BUSINESS,
  FakeSettings,
  NOW,
  RecordingSleeper,
  RUN,
  ScriptedAdapter,
} from '../test/fakes.js';
import { createToolQueries, seed } from '../index.js';
import { KyselyToolCallRepository, KyselyToolRepository } from './kysely-tool-repositories.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const ids = new Uuid7Generator();
const tools = new KyselyToolRepository(db);
const calls = new KyselyToolCallRepository(db);

beforeEach(async () => {
  await sql`SET FOREIGN_KEY_CHECKS=0`.execute(db);
  await sql`TRUNCATE TABLE tool_calls`.execute(db);
  await sql`TRUNCATE TABLE tools`.execute(db);
  await sql`SET FOREIGN_KEY_CHECKS=1`.execute(db);
  await seed({ db, clock: new FixedClock(NOW) });
});

afterAll(async () => {
  await db.destroy();
});

function record(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    id: ids.next(),
    runId: RUN,
    stepKey: 'maps',
    attemptN: 1,
    reused: false,
    businessId: BUSINESS,
    toolKey: 'google.places-text-search',
    inputHash: 'b'.repeat(64),
    input: { textQuery: 'bakery' },
    output: { places: [{ name: 'Crumb & Co' }] },
    units: 1,
    millicredits: 9_000,
    providerCostMicros: 35_000,
    status: 'ok',
    error: null,
    durationMs: 12,
    createdAt: NOW,
    ...overrides,
  };
}

describe('FR-23: seed and Tool repository', () => {
  test('seeds every Tool enabled with the Rate card, idempotently, keeping Staff changes', async () => {
    const all = await tools.list();
    expect(all).toHaveLength(TOOL_CATALOG.length);
    expect(all.every((t) => t.enabled)).toBe(true);
    const places = await tools.find('google.places-text-search');
    expect(places).toMatchObject({
      creditsPerUnit: 9,
      providerCostMicrosPerUnit: 35_000,
      maxUnitsPerCall: 1,
    });
    expect((await tools.find('claude.fast'))?.creditsPerUnit).toBe(0.03);
    if (places) await tools.save({ ...places, creditsPerUnit: 12.345, enabled: false });
    await seed({ db, clock: new FixedClock(NOW) });
    expect(await tools.find('google.places-text-search')).toMatchObject({
      creditsPerUnit: 12.345,
      enabled: false,
    });
    expect(await tools.list()).toHaveLength(TOOL_CATALOG.length);
  });
});

describe('FR-36: Tool call repository', () => {
  test('round-trips a record, JSON included', async () => {
    const r = record();
    await calls.add([r]);
    expect(await calls.listForRun(RUN)).toEqual([r]);
  });

  test('finds the first ok, not reused call for the same run, Step, Tool and input', async () => {
    const failed = record({ status: 'error', error: 'x', output: null });
    const ok = record({ createdAt: new Date(NOW.getTime() + 1) });
    const reused = record({ reused: true, output: null, createdAt: new Date(NOW.getTime() + 2) });
    await calls.add([failed, ok, reused]);
    const q = { runId: RUN, stepKey: 'maps', toolKey: ok.toolKey, inputHash: ok.inputHash };
    expect((await calls.findReusable(q))?.id).toBe(ok.id);
    expect(await calls.findReusable({ ...q, stepKey: 'other' })).toBeNull();
    expect(await calls.findReusable({ ...q, inputHash: 'c'.repeat(64) })).toBeNull();
  });

  test('matches a null Step', async () => {
    const r = record({ stepKey: null });
    await calls.add([r]);
    expect(
      (
        await calls.findReusable({
          runId: RUN,
          stepKey: null,
          toolKey: r.toolKey,
          inputHash: r.inputHash,
        })
      )?.id,
    ).toBe(r.id);
  });

  test('24 h stats per Tool: ok + error, reused and skipped excluded, newest error', async () => {
    const hour = 3_600_000;
    await calls.add([
      record({ createdAt: new Date(NOW.getTime() - hour) }),
      record({
        status: 'error',
        error: 'older',
        output: null,
        createdAt: new Date(NOW.getTime() - 2 * hour),
      }),
      record({
        status: 'error',
        error: 'newest',
        output: null,
        createdAt: new Date(NOW.getTime() - hour),
      }),
      record({ reused: true, output: null }),
      record({ status: 'skipped', output: null }),
      record({ createdAt: new Date(NOW.getTime() - 30 * hour) }),
      record({ toolKey: 'firecrawl.scrape', runId: null, stepKey: null }),
    ]);
    const stats = await calls.statsSince(new Date(NOW.getTime() - 24 * hour));
    expect(stats.get('google.places-text-search')).toEqual({
      calls: 3,
      errors: 2,
      lastErrorAt: new Date(NOW.getTime() - hour),
      lastError: 'newest',
    });
    expect(stats.get('firecrawl.scrape')).toEqual({
      calls: 1,
      errors: 0,
      lastErrorAt: null,
      lastError: null,
    });
  });
});

describe('FR-30: Tool spend for the Staff dashboard', () => {
  test('cost, calls and errors per Tool in [from, to): reused and skipped left out', async () => {
    const hour = 3_600_000;
    const from = new Date(NOW.getTime() - 24 * hour);
    await calls.add([
      record({ providerCostMicros: 1_000, createdAt: new Date(NOW.getTime() - hour) }),
      record({
        status: 'error',
        error: 'boom',
        output: null,
        providerCostMicros: 0,
        createdAt: from,
      }),
      record({ reused: true, output: null, providerCostMicros: 900 }),
      record({ status: 'skipped', output: null, providerCostMicros: 900 }),
      record({ providerCostMicros: 900, createdAt: new Date(from.getTime() - 1) }),
      record({ providerCostMicros: 900, createdAt: NOW }),
      record({
        toolKey: 'firecrawl.scrape',
        runId: null,
        stepKey: null,
        providerCostMicros: 250,
        createdAt: new Date(NOW.getTime() - hour),
      }),
    ]);
    const spend = await calls.spendBetween({ from, to: NOW });
    expect([...spend].sort((a, b) => a.toolKey.localeCompare(b.toolKey))).toEqual([
      { toolKey: 'firecrawl.scrape', providerCostMicros: 250, calls: 1, errors: 0 },
      { toolKey: 'google.places-text-search', providerCostMicros: 1_000, calls: 2, errors: 1 },
    ]);
    expect(await calls.spendBetween({ from: NOW, to: NOW })).toEqual([]);
  });
});

describe('FR-36: ToolRunner on MySQL inside a caller transaction', () => {
  test('records in the given transaction; a rollback leaves nothing; a retry reuses the stored call', async () => {
    const places = new ScriptedAdapter('google.places-text-search');
    const runner = new ToolRunner({
      tools,
      calls: (within?: typeof db) => (within ? new KyselyToolCallRepository(within) : calls),
      adapters: adapterRegistry([places.registered()]),
      settings: new FakeSettings(),
      clock: new FixedClock(NOW),
      ids,
      sleeper: new RecordingSleeper(),
    });
    const req = {
      businessId: BUSINESS,
      runId: RUN,
      stepKey: 'maps',
      attemptN: 1,
      toolKey: 'google.places-text-search',
      input: { q: 'bakery' },
    };
    await expect(
      db.transaction().execute(async (trx) => {
        await runner.call({ ...req, within: trx });
        throw new Error('crash before commit');
      }),
    ).rejects.toThrow('crash');
    expect(await calls.listForRun(RUN)).toEqual([]);

    await db.transaction().execute((trx) => runner.call({ ...req, within: trx }));
    const again = await runner.call({ ...req, attemptN: 2 });
    expect(again).toMatchObject({ reused: true, millicredits: 0 });
    expect(places.calls).toHaveLength(2);
    expect(
      (await calls.listForRun(RUN)).map((c) => [c.attemptN, c.reused, c.millicredits]),
    ).toEqual([
      [1, false, 9_000],
      [2, true, 0],
    ]);
  });
});

describe('prd-expenses FR-6: ToolQueries metered cost and providers (MySQL)', () => {
  const queries = () => createToolQueries({ db, settings: new FakeSettings() });

  test('meteredCostByProvider: UTC month edges, every status, only providers with cost', async () => {
    await calls.add([
      record({ providerCostMicros: 1_000, createdAt: new Date('2026-10-31T23:59:59.999Z') }),
      record({ providerCostMicros: 35_000, createdAt: new Date('2026-11-01T00:00:00.000Z') }),
      record({
        providerCostMicros: 5_000,
        status: 'error',
        error: 'x',
        output: null,
        createdAt: new Date('2026-11-30T23:59:59.000Z'),
      }),
      record({
        toolKey: 'firecrawl.scrape',
        providerCostMicros: 2_000,
        reused: true,
        output: null,
        createdAt: new Date('2026-11-15T00:00:00.000Z'),
      }),
      record({
        toolKey: 'firecrawl.scrape',
        providerCostMicros: 0,
        createdAt: new Date('2026-11-16T00:00:00.000Z'),
      }),
      record({ providerCostMicros: 9_000, createdAt: new Date('2026-12-01T00:00:00.000Z') }),
    ]);
    const q = queries();
    expect(await q.meteredCostByProvider('2026-11')).toEqual([
      { provider: 'Firecrawl', micros: 2_000 },
      { provider: 'Google Maps Platform', micros: 40_000 },
    ]);
    expect(await q.meteredCostByProvider('2026-12')).toEqual([
      { provider: 'Google Maps Platform', micros: 9_000 },
    ]);
    expect(await q.meteredCostByProvider('2026-09')).toEqual([]);
    await expect(q.meteredCostByProvider('2026-1')).rejects.toThrow('Invalid month');
  });

  test('providers: distinct providers with their Tool keys, sorted by name', async () => {
    const list = await queries().providers();
    expect(list.map((p) => p.name)).toEqual(
      [...new Set(TOOL_CATALOG.map((t) => t.provider))].sort((a, b) => a.localeCompare(b)),
    );
    expect(list.find((p) => p.name === 'Firecrawl')?.toolKeys).toEqual(['firecrawl.scrape']);
    expect(list.find((p) => p.name === 'Google Maps Platform')?.toolKeys).toEqual(
      TOOL_CATALOG.filter((t) => t.provider === 'Google Maps Platform')
        .map((t) => t.key)
        .sort(),
    );
    expect(list.flatMap((p) => p.toolKeys).sort()).toEqual(TOOL_CATALOG.map((t) => t.key).sort());
  });
});
