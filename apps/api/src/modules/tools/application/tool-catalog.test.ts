import { tool as toolContract } from '@app/contracts/tools';
import { describe, expect, test } from 'vitest';
import {
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../../shared/domain/errors.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import {
  BUSINESS,
  catalogSnapshots,
  FakeSettings,
  InMemoryToolCallRepository,
  InMemoryToolRepository,
  NOW,
  ownerActor,
  RUN,
  staffActor,
} from '../test/fakes.js';
import { LlmUsageMeter, thousandTokenUnits } from './llm-usage-meter.js';
import type { ToolCallRecord } from './ports.js';
import {
  ListTools,
  STARTED_WITHOUT_RESULT,
  ToolQueries,
  UpdateTool,
  type ToolAudit,
  type ToolCatalogTransaction,
} from './tool-catalog.js';

class RecordingAudit implements ToolAudit {
  readonly entries: Parameters<ToolAudit['record']>[0][] = [];
  readonly within: unknown[] = [];
  failNext = false;
  record(entry: Parameters<ToolAudit['record']>[0], within?: object): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('audit log down'));
    }
    this.entries.push(entry);
    this.within.push(within);
    return Promise.resolve();
  }
}

function fixture() {
  const tools = new InMemoryToolRepository(catalogSnapshots());
  const calls = new InMemoryToolCallRepository();
  const settings = new FakeSettings();
  const clock = new FixedClock(NOW);
  const audit = new RecordingAudit();
  const deps = { tools, calls, settings, clock };
  /** A transaction over the in-memory Tools: a throw rolls the Tools back. */
  const transaction: ToolCatalogTransaction = async (fn) => {
    const before = [...tools.rows.entries()].map(([k, v]) => [k, structuredClone(v)] as const);
    try {
      return await fn({ tools, within: { tx: 'catalog' } });
    } catch (error) {
      tools.rows.clear();
      for (const [k, v] of before) tools.rows.set(k, v);
      throw error;
    }
  };
  return {
    ...deps,
    audit,
    list: new ListTools(deps),
    update: new UpdateTool({ ...deps, audit, transaction }),
    queries: new ToolQueries(deps),
  };
}

let seq = 0;
function call(overrides: Partial<ToolCallRecord>): ToolCallRecord {
  seq += 1;
  return {
    id: `00000000-0000-7000-8000-${seq.toString().padStart(12, '0')}`,
    runId: RUN,
    stepKey: 'maps',
    attemptN: 1,
    reused: false,
    businessId: BUSINESS,
    toolKey: 'google.places-text-search',
    inputHash: 'a'.repeat(64),
    input: {},
    output: null,
    units: 1,
    millicredits: 9_000,
    providerCostMicros: 35_000,
    status: 'ok',
    error: null,
    durationMs: 5,
    createdAt: NOW,
    ...overrides,
  };
}

describe('FR-23: list Tools (Staff)', () => {
  test('lists every Tool with margin, configured and 24 h health; parses against the contract', async () => {
    const f = fixture();
    f.settings.credentials.hunter = { apiKey: null };
    const hourAgo = new Date(NOW.getTime() - 3_600_000);
    await f.calls.add([
      call({ createdAt: hourAgo }),
      call({ status: 'error', error: 'PROVIDER_ERROR: 503', createdAt: hourAgo }),
      call({
        status: 'error',
        error: 'PROVIDER_ERROR: old',
        createdAt: new Date(NOW.getTime() - 25 * 3_600_000),
      }),
      call({ reused: true, millicredits: 0 }),
      call({ status: 'skipped' }),
      call({}),
    ]);
    const { items } = await f.list.execute({ actor: staffActor });
    for (const item of items) toolContract.parse(item);
    expect(items).toHaveLength(18);
    const places = items.find((t) => t.key === 'google.places-text-search');
    expect(places).toMatchObject({
      unit: 'request',
      creditsPerUnit: 9,
      providerCostMicrosPerUnit: 35_000,
      marginPct: 61.1,
      enabled: true,
      configured: true,
      health: {
        calls24h: 3,
        errorRate24h: 33.3,
        lastErrorAt: hourAgo.toISOString(),
        lastError: 'PROVIDER_ERROR: 503',
      },
    });
    expect(items.find((t) => t.key === 'hunter.domain-search')?.configured).toBe(false);
    expect(items.find((t) => t.key === 'osm.overpass')?.configured).toBe(true);
    expect(items.find((t) => t.key === 'zerobounce.validate')?.health).toEqual({
      calls24h: 0,
      errorRate24h: null,
      lastErrorAt: null,
      lastError: null,
    });
  });

  test('Claude Tools are configured by the Anthropic key', async () => {
    const f = fixture();
    f.settings.anthropicApiKey = null;
    const { items } = await f.list.execute({ actor: staffActor });
    expect(items.find((t) => t.key === 'claude.fast')?.configured).toBe(false);
  });

  test('needs Staff', async () => {
    const f = fixture();
    await expect(f.list.execute({ actor: ownerActor })).rejects.toThrow(ForbiddenError);
    await expect(f.list.execute({ actor: null })).rejects.toThrow(UnauthenticatedError);
  });
});

describe('FR-23: update a Tool (Staff)', () => {
  test('AJ-7: disable a Tool and reprice another; each change is audited', async () => {
    const f = fixture();
    const yelp = await f.update.execute({
      actor: staffActor,
      key: 'apify.yelp',
      changes: { enabled: false },
    });
    expect(yelp.enabled).toBe(false);
    const places = await f.update.execute({
      actor: staffActor,
      key: 'google.places-text-search',
      changes: { creditsPerUnit: 10 },
    });
    expect(places).toMatchObject({ creditsPerUnit: 10, marginPct: 65 });
    expect((await f.tools.find('google.places-text-search'))?.creditsPerUnit).toBe(10);
    expect(f.audit.entries).toEqual([
      {
        staffMemberId: staffActor.memberId,
        businessId: null,
        action: 'tool.updated',
        targetType: 'tool',
        targetId: 'apify.yelp',
        details: { fields: ['enabled'], enabled: { from: true, to: false } },
      },
      expect.objectContaining({
        targetId: 'google.places-text-search',
        details: { fields: ['creditsPerUnit'], creditsPerUnit: { from: 9, to: 10 } },
      }),
    ]);
  });

  test('the change and its audit entry are written in one transaction', async () => {
    const f = fixture();
    await f.update.execute({ actor: staffActor, key: 'apify.yelp', changes: { enabled: false } });
    expect(f.audit.within).toEqual([{ tx: 'catalog' }]);

    f.audit.failNext = true;
    await expect(
      f.update.execute({
        actor: staffActor,
        key: 'google.places-text-search',
        changes: { creditsPerUnit: 10 },
      }),
    ).rejects.toThrow('audit log down');
    // No audit entry, no change.
    expect((await f.tools.find('google.places-text-search'))?.creditsPerUnit).toBe(9);
    expect(f.audit.entries).toHaveLength(1);
  });

  test('a change to the same values writes no audit entry', async () => {
    const f = fixture();
    await f.update.execute({ actor: staffActor, key: 'apify.yelp', changes: { enabled: true } });
    expect(f.audit.entries).toEqual([]);
  });

  test('unknown Tool → NotFound; owner → Forbidden; bad price → ValidationError', async () => {
    const f = fixture();
    await expect(
      f.update.execute({ actor: staffActor, key: 'nope', changes: { enabled: false } }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      f.update.execute({ actor: ownerActor, key: 'apify.yelp', changes: { enabled: false } }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      f.update.execute({
        actor: staffActor,
        key: 'apify.yelp',
        changes: { creditsPerUnit: 1.0005 },
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe('FR-18: Tool availability for research', () => {
  test('reports enabled and configured per key; unknown keys are unavailable', async () => {
    const f = fixture();
    f.settings.credentials.zerobounce = { apiKey: null };
    const tool = await f.tools.find('apify.yelp');
    if (tool) await f.tools.save({ ...tool, enabled: false });
    expect(
      await f.queries.availability([
        'google.places-text-search',
        'apify.yelp',
        'zerobounce.validate',
        'x',
      ]),
    ).toEqual([
      { key: 'google.places-text-search', enabled: true, configured: true },
      { key: 'apify.yelp', enabled: false, configured: true },
      { key: 'zerobounce.validate', enabled: true, configured: false },
      { key: 'x', enabled: false, configured: false },
    ]);
  });

  test('a run’s Tool calls with attempt and reused', async () => {
    const f = fixture();
    await f.calls.add([call({ attemptN: 2, reused: true }), call({ runId: null })]);
    const calls = await f.queries.callsForRun(RUN);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      attempt: 2,
      reused: true,
      toolKey: 'google.places-text-search',
    });
  });
});

describe('FR-32: a call whose worker stopped mid-call', () => {
  test('a Tool call left started shows as an error without a result', async () => {
    const f = fixture();
    await f.calls.add([call({ status: 'started', units: 0, millicredits: 0 })]);
    const [shown] = await f.queries.callsForRun(RUN);
    expect(shown).toMatchObject({ status: 'error', error: STARTED_WITHOUT_RESULT });
  });
});

describe('FR-14: LlmUsageMeter', () => {
  function meter() {
    const f = fixture();
    const errors: unknown[] = [];
    const m = new LlmUsageMeter({
      tools: f.tools,
      calls: f.calls,
      models: () => f.settings.ai(),
      clock: f.clock,
      ids: new SequentialIdGenerator(),
      onError: (e) => errors.push(e),
    });
    return { ...f, m, errors };
  }

  test('1k-token units round up', () => {
    expect([0, 1, 1000, 1001, 2500].map(thousandTokenUnits)).toEqual([0, 1, 1, 2, 3]);
  });

  test('a chat call is recorded as two Tool calls with no run, by model role', async () => {
    const f = meter();
    await f.m.onLlmUsage({
      businessId: BUSINESS,
      purpose: 'assistant.welcome',
      model: 'claude-sonnet-5-5',
      inputTokens: 2_400,
      outputTokens: 300,
    });
    expect(
      f.calls.rows.map((r) => [r.toolKey, r.units, r.millicredits, r.providerCostMicros]),
    ).toEqual([
      ['claude.chat', 3, 1_800, 6_000],
      ['claude.chat.out', 1, 3_000, 10_000],
    ]);
    expect(f.calls.rows[0]).toMatchObject({
      runId: null,
      stepKey: null,
      businessId: BUSINESS,
      status: 'ok',
    });
  });

  test('the planning and fast models map to their Tools', async () => {
    const f = meter();
    const usage = { businessId: BUSINESS, purpose: 'p', inputTokens: 1, outputTokens: 1 };
    await f.m.onLlmUsage({ ...usage, model: 'claude-opus-5-5' });
    await f.m.onLlmUsage({ ...usage, model: 'claude-haiku-5-5' });
    expect(f.calls.rows.map((r) => r.toolKey)).toEqual([
      'claude.planning',
      'claude.planning.out',
      'claude.fast',
      'claude.fast.out',
    ]);
  });

  test('a recording failure is reported, not thrown', async () => {
    const f = meter();
    f.calls.add = () => Promise.reject(new Error('db down'));
    await expect(
      f.m.onLlmUsage({
        businessId: BUSINESS,
        purpose: 'p',
        model: 'm',
        inputTokens: 1,
        outputTokens: 1,
      }),
    ).resolves.toBeUndefined();
    expect(f.errors).toHaveLength(1);
  });
});

describe('finance P&L: closed months of metered cost are cached', () => {
  function counting() {
    const f = fixture();
    const windows: { from: string; to: string }[] = [];
    const read = f.calls.costByToolMonthBetween.bind(f.calls);
    f.calls.costByToolMonthBetween = (w) => {
      windows.push({ from: w.from.toISOString(), to: w.to.toISOString() });
      return read(w);
    };
    return { ...f, windows };
  }

  test('a closed month is read once; the open month is read on every call', async () => {
    const f = counting();
    f.clock.set(new Date('2026-12-10T12:00:00.000Z'));
    await f.calls.add([
      call({ providerCostMicros: 1_000, createdAt: new Date('2026-11-05T00:00:00.000Z') }),
      call({ providerCostMicros: 2_000, createdAt: new Date('2026-12-05T00:00:00.000Z') }),
    ]);
    const first = await f.queries.meteredCostByProviderMonths('2026-10', '2026-12');
    await f.calls.add([
      call({ providerCostMicros: 4_000, createdAt: new Date('2026-12-09T00:00:00.000Z') }),
    ]);
    const second = await f.queries.meteredCostByProviderMonths('2026-10', '2026-12');

    expect(first.map((r) => [r.month, r.micros])).toEqual([
      ['2026-11', 1_000],
      ['2026-12', 2_000],
    ]);
    expect(second.map((r) => [r.month, r.micros])).toEqual([
      ['2026-11', 1_000],
      ['2026-12', 6_000],
    ]);
    expect(f.windows).toEqual([
      { from: '2026-10-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' },
      { from: '2026-12-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' },
    ]);
  });

  test('a month is not cached until an hour after it ends', async () => {
    const f = counting();
    f.clock.set(new Date('2026-12-01T00:30:00.000Z'));
    await f.queries.meteredCostByProviderMonths('2026-11', '2026-11');
    await f.calls.add([
      call({ providerCostMicros: 3_000, createdAt: new Date('2026-11-30T23:59:59.000Z') }),
    ]);
    f.clock.set(new Date('2026-12-01T01:00:00.000Z'));
    const late = await f.queries.meteredCostByProviderMonths('2026-11', '2026-11');
    await f.queries.meteredCostByProviderMonths('2026-11', '2026-11');

    expect(late.map((r) => r.micros)).toEqual([3_000]);
    expect(f.windows).toHaveLength(2);
  });

  test('without a clock nothing is cached', async () => {
    const f = counting();
    const queries = new ToolQueries({ tools: f.tools, calls: f.calls, settings: f.settings });
    await queries.meteredCostByProviderMonths('2026-01', '2026-02');
    await queries.meteredCostByProviderMonths('2026-01', '2026-02');
    expect(f.windows).toHaveLength(2);
  });
});
