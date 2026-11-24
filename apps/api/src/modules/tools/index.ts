import type { FastifyInstance } from 'fastify';
import type { Transaction } from 'kysely';
import type { LlmClient } from '../../shared/application/llm-client.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type { Database } from '../../shared/infrastructure/db/database.js';
import type { DB } from '../../shared/infrastructure/db/schema.js';
import { LlmUsageMeter, type LlmUsage } from './application/llm-usage-meter.js';
import { realSleeper, type ProviderSettings, type Sleeper } from './application/ports.js';
import { ListTools, ToolQueries, UpdateTool, type ToolAudit } from './application/tool-catalog.js';
import {
  ToolRunner,
  type ToolCallRequest,
  type ToolCallResult,
} from './application/tool-runner.js';
import { toolsRoutes, type ToolsRouteDeps } from './http/tools.routes.js';
import { createFakeAdapterRegistry, createLiveAdapters } from './infrastructure/adapters/index.js';
import type { Fetch } from './infrastructure/adapters/http.js';
import {
  FakeToolControls,
  InMemoryFaultStore,
  RedisFaultStore,
  type RedisLike,
} from './infrastructure/fake/fake-tool-controls.js';
import {
  KyselyToolCallRepository,
  KyselyToolRepository,
} from './infrastructure/kysely-tool-repositories.js';
import { seedDemoToolCalls, seedToolCatalog } from './infrastructure/seed-tools.js';

export { TOOL_KEYS, ALL_TOOL_KEYS, CLAUDE_TOOLS } from './domain/tool-keys.js';
export type { ToolKey, ClaudeRole } from './domain/tool-keys.js';
export { TOOL_CATALOG } from './domain/catalog.js';
export {
  RETRY_DELAYS_MS,
  LONGEST_TRY_MS,
  LONGEST_TOOL_CALL_MS,
  inputHash,
} from './application/tool-runner.js';
export type { ToolCallRequest, ToolCallResult, ToolCallError } from './application/tool-runner.js';
export type { ToolErrorCode } from './application/tool-adapter.js';
export type { ToolAvailability } from './application/tool-catalog.js';
export type { LlmUsage } from './application/llm-usage-meter.js';
export type { Sleeper, ProviderSettings, ToolSpend } from './application/ports.js';
export * from './infrastructure/tool-io.js';
export { LlmUsageMeter, ToolQueries };
export { FakeToolControls, InMemoryFaultStore, RedisFaultStore };
export type { RedisLike };
export { createGoogleGeocoder } from './infrastructure/adapters/google.js';
export { APIFY_ACTORS, APIFY_WAIT_SECS } from './infrastructure/adapters/apify.js';
export { FAKE_BUSINESSES, type FakeBusiness } from './infrastructure/fake/austin-businesses.js';

const MODULE_NAME = 'tools';

/**
 * Placeholder kept so app.ts's module list stays complete; main.ts registers the module built by
 * `createTools(...)` instead (its routes need dependencies).
 */
export const toolsModule = {
  name: MODULE_NAME,
  register(_app: FastifyInstance): void {
    // Intentionally empty: see createTools / createToolsModule.
  },
};

/** The tools AppModule from its use cases (tests pass use cases built on fakes). */
export function createToolsModule(deps: ToolsRouteDeps) {
  return {
    name: MODULE_NAME,
    register(app: FastifyInstance): void {
      toolsRoutes(app, deps);
    },
  };
}

/** platform's SettingsReader: provider keys and the AI section (models name the Claude Tools). */
export interface ToolsSettings extends ProviderSettings {
  ai(): Promise<{
    readonly anthropicApiKey: string | null;
    readonly planningModel: string;
    readonly chatModel: string;
    readonly fastModel: string;
  }>;
}

/** The runner research uses: `within` is the caller's Kysely transaction (FR-36 handoff). */
export interface DbToolRunner {
  call(req: ToolCallRequest<Transaction<DB>>): Promise<ToolCallResult>;
}

export interface ToolRunnerDeps {
  db: Database;
  clock: Clock;
  ids: IdGenerator;
  settings: ToolsSettings;
  /** `fake` (dev, test, e2e) serves fixtures; `live` calls the providers. */
  mode: 'live' | 'fake';
  /** Claude for run Steps: AnthropicLlmClient live, the scripted fake in fake mode. */
  llm: LlmClient;
  /** The fake Tools' error modes (fake mode). Defaults to an in-memory store. */
  fakeControls?: FakeToolControls;
  /** Waits between retries and for Overpass throttling (tests pass an instant one). */
  sleeper?: Sleeper;
  /** Retry waits; default 1 s, 4 s, 16 s (FR-20). */
  retryDelaysMs?: readonly number[];
  fetch?: Fetch;
}

/** The metering ToolRunner on MySQL (api and worker). `toolRunner.call(req)`. */
export function createToolRunner(deps: ToolRunnerDeps): DbToolRunner {
  const sleeper = deps.sleeper ?? realSleeper;
  const adapterDeps = {
    settings: deps.settings,
    clock: deps.clock,
    sleeper,
    llm: deps.llm,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  };
  const adapters =
    deps.mode === 'fake'
      ? createFakeAdapterRegistry({
          ...adapterDeps,
          controls: deps.fakeControls ?? new FakeToolControls(),
        })
      : createLiveAdapters(adapterDeps);
  return new ToolRunner<Transaction<DB>>({
    tools: new KyselyToolRepository(deps.db),
    calls: (within) => new KyselyToolCallRepository(within ?? deps.db),
    adapters,
    settings: deps.settings,
    clock: deps.clock,
    ids: deps.ids,
    sleeper,
    ...(deps.retryDelaysMs ? { retryDelaysMs: deps.retryDelaysMs } : {}),
  });
}

/** Fake error modes shared by api and worker through Valkey (or in memory without one). */
export function createFakeToolControls(options: { redis?: RedisLike } = {}): FakeToolControls {
  return new FakeToolControls(
    options.redis ? new RedisFaultStore(options.redis) : new InMemoryFaultStore(),
  );
}

export interface Tools {
  module: ReturnType<typeof createToolsModule>;
  toolRunner: DbToolRunner;
  /** The assistant's `usage` listener (FR-14): meters chat Claude calls with no run. */
  llmUsageMeter: LlmUsageMeter;
  toolQueries: ToolQueries;
  fakeControls: FakeToolControls;
}

/** tools' public read side on MySQL alone (reporting's tests, scripts). */
export function createToolQueries(deps: {
  db: Database;
  settings: ProviderSettings;
  /** Given, closed months' metered cost is cached (meteredCostByProviderMonths). */
  clock?: Clock;
}): ToolQueries {
  return new ToolQueries({
    tools: new KyselyToolRepository(deps.db),
    calls: new KyselyToolCallRepository(deps.db),
    settings: deps.settings,
    ...(deps.clock ? { clock: deps.clock } : {}),
  });
}

/** Everything the api needs from tools, on MySQL. */
export function createTools(
  deps: ToolRunnerDeps & {
    audit: ToolAudit;
    /** ENABLE_TEST_HOOKS and not production: adds POST /api/test/tools/fail (fake mode only). */
    testHooks?: boolean;
    onMeterError?: (error: unknown, usage: LlmUsage) => void;
  },
): Tools {
  const fakeControls = deps.fakeControls ?? new FakeToolControls();
  const tools = new KyselyToolRepository(deps.db);
  const calls = new KyselyToolCallRepository(deps.db);
  const catalogDeps = { tools, calls, settings: deps.settings, clock: deps.clock };
  const toolQueries = new ToolQueries(catalogDeps);
  return {
    module: createToolsModule({
      listTools: new ListTools(catalogDeps),
      updateTool: new UpdateTool({
        ...catalogDeps,
        audit: deps.audit,
        // The Rate card change and its Audit log entry commit together (FR-7, FR-23).
        transaction: (fn) =>
          deps.db
            .transaction()
            .execute((trx) => fn({ tools: new KyselyToolRepository(trx), within: trx })),
      }),
      testHooks: deps.testHooks && deps.mode === 'fake' ? { controls: fakeControls } : undefined,
    }),
    toolRunner: createToolRunner({ ...deps, fakeControls }),
    llmUsageMeter: new LlmUsageMeter({
      tools,
      calls,
      models: () => deps.settings.ai(),
      clock: deps.clock,
      ids: deps.ids,
      ...(deps.onMeterError ? { onError: deps.onMeterError } : {}),
    }),
    toolQueries,
    fakeControls,
  };
}

/**
 * Demo data (PRD section 8a), called by scripts/seed.ts in dependency order: every Tool with the
 * seeded Rate card, enabled (Apify Yelp included). Idempotent; keeps Staff's changes. Safe for
 * production too (release notes: seed the Tools and Rate card). With `demo` (scripts/seed.ts,
 * never production) it also adds the November 2026 metered Tool calls (prd-expenses 8a).
 */
export async function seed(deps: {
  db: Database;
  clock: Clock;
  demo?: { businesses: { sweetSupply: string } };
}): Promise<void> {
  await seedToolCatalog(new KyselyToolRepository(deps.db), deps.clock.now());
  if (deps.demo) await seedDemoToolCalls(deps.db, deps.demo.businesses.sweetSupply);
}
