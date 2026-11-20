import { z } from 'zod';
import type { Actor } from '../../../shared/domain/actor.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import type {
  ProviderCredentials,
  ProviderSettings,
  Sleeper,
  ToolCallRecord,
  ToolCallRepository,
  ToolRepository,
  ToolSpend,
} from '../application/ports.js';
import {
  adapterRegistry,
  type AdapterResult,
  type RegisteredAdapter,
} from '../application/tool-adapter.js';
import { registerAdapter } from '../infrastructure/adapters/register.js';
import { ToolRunner } from '../application/tool-runner.js';
import { TOOL_CATALOG } from '../domain/catalog.js';
import type { ToolStats } from '../domain/health.js';
import type { ToolSnapshot } from '../domain/tool.js';

export const NOW = new Date('2026-11-19T10:00:00.000Z');
export const BUSINESS = '00000000-0000-7000-8000-00000000b001';
export const RUN = '00000000-0000-7000-8000-00000000a001';

export const staffActor: Actor = {
  memberId: '00000000-0000-7000-8000-00000000c001',
  businessId: BUSINESS,
  roles: ['owner', 'staff'],
  emailVerified: true,
};
export const ownerActor: Actor = { ...staffActor, roles: ['owner'] };

export function catalogSnapshots(updatedAt = NOW): ToolSnapshot[] {
  return TOOL_CATALOG.map((d) => ({
    key: d.key,
    name: d.name,
    provider: d.provider,
    unit: d.unit,
    creditsPerUnit: d.creditsPerUnit,
    providerCostMicrosPerUnit: d.providerCostMicrosPerUnit,
    enabled: true,
    maxUnitsPerCall: d.maxUnitsPerCall,
    updatedAt,
  }));
}

export class InMemoryToolRepository implements ToolRepository {
  readonly rows = new Map<string, ToolSnapshot>();

  constructor(tools: readonly ToolSnapshot[] = []) {
    for (const t of tools) this.rows.set(t.key, structuredClone(t));
  }
  list(): Promise<ToolSnapshot[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((t) => structuredClone(t)),
    );
  }
  find(key: string): Promise<ToolSnapshot | null> {
    const row = this.rows.get(key);
    return Promise.resolve(row ? structuredClone(row) : null);
  }
  save(tool: ToolSnapshot): Promise<void> {
    this.rows.set(tool.key, structuredClone(tool));
    return Promise.resolve();
  }
}

export class InMemoryToolCallRepository implements ToolCallRepository {
  readonly rows: ToolCallRecord[] = [];

  add(records: readonly ToolCallRecord[]): Promise<void> {
    this.rows.push(...records.map((r) => structuredClone(r)));
    return Promise.resolve();
  }
  complete(record: ToolCallRecord): Promise<void> {
    const i = this.rows.findIndex((r) => r.id === record.id && r.status === 'started');
    if (i >= 0) this.rows[i] = { ...structuredClone(record), createdAt: this.rows[i]!.createdAt };
    return Promise.resolve();
  }
  findReusable(q: {
    runId: string;
    stepKey: string | null;
    toolKey: string;
    inputHash: string;
  }): Promise<ToolCallRecord | null> {
    const found = this.rows.find(
      (r) =>
        r.runId === q.runId &&
        r.stepKey === q.stepKey &&
        r.toolKey === q.toolKey &&
        r.inputHash === q.inputHash &&
        r.status === 'ok' &&
        !r.reused,
    );
    return Promise.resolve(found ? structuredClone(found) : null);
  }
  spendBetween(window: { from: Date; to: Date }): Promise<ToolSpend[]> {
    const spend = new Map<string, ToolSpend>();
    for (const r of this.rows) {
      if (r.createdAt < window.from || r.createdAt >= window.to) continue;
      if (r.reused || r.status === 'skipped' || r.status === 'started') continue;
      const s = spend.get(r.toolKey) ?? {
        toolKey: r.toolKey,
        providerCostMicros: 0,
        calls: 0,
        errors: 0,
      };
      spend.set(r.toolKey, {
        toolKey: r.toolKey,
        providerCostMicros: s.providerCostMicros + r.providerCostMicros,
        calls: s.calls + 1,
        errors: s.errors + (r.status === 'error' ? 1 : 0),
      });
    }
    return Promise.resolve([...spend.values()]);
  }
  statsSince(since: Date): Promise<Map<string, ToolStats>> {
    const stats = new Map<string, ToolStats>();
    const counted = this.rows
      .filter(
        (r) =>
          r.createdAt >= since && !r.reused && r.status !== 'skipped' && r.status !== 'started',
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const r of counted) {
      const s = stats.get(r.toolKey) ?? { calls: 0, errors: 0, lastErrorAt: null, lastError: null };
      const failed = r.status === 'error';
      stats.set(r.toolKey, {
        calls: s.calls + 1,
        errors: s.errors + (failed ? 1 : 0),
        lastErrorAt: failed ? r.createdAt : s.lastErrorAt,
        lastError: failed ? r.error : s.lastError,
      });
    }
    return Promise.resolve(stats);
  }
  listForRun(runId: string): Promise<ToolCallRecord[]> {
    return Promise.resolve(
      this.rows
        .filter((r) => r.runId === runId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .map((r) => structuredClone(r)),
    );
  }
}

const ALL_KEYS: ProviderCredentials = {
  apify: { apiKey: 'apify-key' },
  googleMaps: { apiKey: 'gmaps-key' },
  firecrawl: { apiKey: 'fc-key' },
  apollo: { apiKey: 'apollo-key' },
  hunter: { apiKey: 'hunter-key' },
  zerobounce: { apiKey: 'zb-key' },
  twilio: { accountSid: 'AC123', authToken: 'twilio-token' },
};

/** Platform settings with every key set (tests override single providers). */
export class FakeSettings implements ProviderSettings {
  anthropicApiKey: string | null = 'sk-ant-test';
  credentials: { -readonly [K in keyof ProviderCredentials]: ProviderCredentials[K] } = {
    ...ALL_KEYS,
  };
  models = {
    planningModel: 'claude-opus-5-5',
    chatModel: 'claude-sonnet-5-5',
    fastModel: 'claude-haiku-5-5',
  };

  ai() {
    return Promise.resolve({ anthropicApiKey: this.anthropicApiKey, ...this.models });
  }
  provider<K extends keyof ProviderCredentials>(key: K): Promise<ProviderCredentials[K]> {
    return Promise.resolve(this.credentials[key]);
  }
}

export class RecordingSleeper implements Sleeper {
  readonly waits: number[] = [];
  sleep(ms: number): Promise<void> {
    this.waits.push(ms);
    return Promise.resolve();
  }
}

/** A scripted adapter: queue results or errors; records every input it was called with. */
export class ScriptedAdapter {
  readonly calls: unknown[] = [];
  private readonly script: (() => Promise<AdapterResult<unknown>>)[] = [];

  constructor(
    readonly key: string,
    private readonly fallback: (input: { q: string; n: number }) => AdapterResult<unknown> = (
      input,
    ) => ({
      output: { items: Array.from({ length: input.n }, (_, i) => `${input.q}-${i}`) },
      units: input.n,
    }),
  ) {}

  then(fn: () => Promise<AdapterResult<unknown>>): this {
    this.script.push(fn);
    return this;
  }

  registered(requires: RegisteredAdapter['requires'] = 'googleMaps'): RegisteredAdapter {
    return registerAdapter({
      key: this.key,
      requires,
      input: z.object({ q: z.string().min(1), n: z.int().min(0).max(100).default(1) }),
      output: z.object({ items: z.array(z.string()) }),
      maxUnits: (input) => input.n,
      run: (input) => {
        this.calls.push(input);
        const next = this.script.shift();
        return next ? next() : Promise.resolve(this.fallback(input));
      },
    });
  }
}

export function runnerFixture(options: { adapters?: RegisteredAdapter[] } = {}) {
  const tools = new InMemoryToolRepository(catalogSnapshots());
  const calls = new InMemoryToolCallRepository();
  const settings = new FakeSettings();
  const sleeper = new RecordingSleeper();
  const clock = new FixedClock(NOW);
  const ids = new SequentialIdGenerator();
  const places = new ScriptedAdapter('google.places-text-search');
  const runner = new ToolRunner<never>({
    tools,
    calls: () => calls,
    adapters: adapterRegistry(options.adapters ?? [places.registered()]),
    settings,
    clock,
    ids,
    sleeper,
  });
  return { tools, calls, settings, sleeper, clock, ids, places, runner };
}
