import type { Worker } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { AnalyticsTracker } from '../../shared/application/analytics-tracker.js';
import type { EmailSender } from '../../shared/application/email-sender.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type { Database } from '../../shared/infrastructure/db/database.js';
import type { OutboxSubscription } from '../../shared/infrastructure/outbox/index.js';
import { SystemClock } from '../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../shared/infrastructure/time/uuid7.js';
import {
  FlowUseCases,
  ResearchFlowDefaults,
  ResearchPlanActivity,
  ResearchReportingQueries,
  ResearchRunStats,
} from './application/flows.js';
import type {
  AuditPort,
  BillingPort,
  Heartbeat,
  IdentityPort,
  PlanSnapshotsPort,
  PlatformSettingsPort,
  ProductNamesPort,
  ProspectStorePort,
  QueueMonitor,
  ResearchStore,
  RunQueue,
  Sleeper,
  StopHook,
  ToolCallLogPort,
  ToolCatalogPort,
  ToolRunnerPort,
} from './application/ports.js';
import { RunExecutor } from './application/run-executor.js';
import { RunEmails } from './application/run-emails.js';
import { RunUseCases } from './application/runs.js';
import { RunSweeper } from './application/sweeper.js';
import { LOCAL_BUYERS_V1 } from './domain/local-buyers.js';
import { researchRoutes } from './http/research.routes.js';
import {
  BullRunQueue,
  createResearchWorkers,
  intervalHeartbeat,
  RedisQueueMonitor,
  RedisStopHook,
  RESEARCH_EMAILS_QUEUE,
  RESEARCH_RUNS_QUEUE,
} from './infrastructure/bullmq.js';
import { KyselyResearchStore } from './infrastructure/kysely-research-store.js';
import { seedDemoRun, type ResearchDemoIds } from './infrastructure/seed.js';

export type {
  AuditPort,
  BillingPort,
  IdentityPort,
  PlanSnapshotsPort,
  PlatformSettingsPort,
  ProductNamesPort,
  Prospect,
  ProspectContact,
  ProspectEvidence,
  ProspectInput,
  ProspectPatch,
  ProspectStorePort,
  ReportWindow,
  RunFact,
  SourceRef,
  ToolCallError,
  ToolCallLogPort,
  ToolCallRequest,
  ToolCallResult,
  ToolCallView,
  ToolCatalogPort,
  ToolRunnerPort,
} from './application/ports.js';
export { LOCAL_BUYERS_KEY, LOCAL_BUYERS_V1, TOOL_KEYS } from './domain/local-buyers.js';
export { fakeResearchAgent, isResearchRequest } from './infrastructure/fake-research-agent.js';
export { RESEARCH_EMAILS_QUEUE, RESEARCH_RUNS_QUEUE } from './infrastructure/bullmq.js';
export { purgeOldMessages } from './infrastructure/kysely-research-store.js';

/** What research needs from other modules (wired in composition.ts / worker-registry.ts). */
export interface ResearchCollaborators {
  clock: Clock;
  ids: IdGenerator;
  analytics: AnalyticsTracker;
  /** billing's `billingCommands` (reserve, topUpReservation, settle). */
  billing: BillingPort;
  /** planning's `planningQueries` (getPlanSnapshot). */
  plans: PlanSnapshotsPort;
  /** The tools module's ToolRunner, catalog availability and Tool call log. */
  tools: ToolRunnerPort;
  catalog: ToolCatalogPort;
  toolCalls: ToolCallLogPort;
  /** The leads module's Prospect storage. */
  prospects: ProspectStorePort;
  /** identity's getOwnerContact and getBusinesses. */
  identity: IdentityPort;
  /** platform's SettingsReader (ceilings, support). */
  settings: PlatformSettingsPort;
  /** platform's Audit log. */
  audit: AuditPort;
  email: EmailSender;
  /** profile's Product names for Pitches and prompts (optional). */
  products?: ProductNamesPort;
  /** APP_URL, for links in run emails. */
  appUrl: string;
}

export interface ResearchQueueDeps {
  connection: Redis;
  /** BullMQ key prefix (tests). */
  prefix?: string;
}

/** The HTTP module's shape (matches app.ts AppModule). */
export interface ResearchHttpModule {
  readonly name: 'research';
  register(app: FastifyInstance): void;
}

export interface Research {
  module: ResearchHttpModule;
  /** For planning (FR-16, FR-17). */
  flowDefaults: ResearchFlowDefaults;
  runStats: ResearchRunStats;
  /** For planning's PlanActivity (lastRuns; leadsCounts comes from leads). */
  planActivity: ResearchPlanActivity;
  /** For reporting's Staff dashboard and customer list (FR-30, FR-31). */
  reportingQueries: ResearchReportingQueries;
  runs: RunUseCases;
  flows: FlowUseCases;
  store: ResearchStore;
}

interface AssembleDeps extends ResearchCollaborators {
  store: ResearchStore;
  monitor: QueueMonitor;
  stopHook?: StopHook;
}

function assemble(deps: AssembleDeps): Research {
  const runs = new RunUseCases({ ...deps, plans: deps.plans });
  const flows = new FlowUseCases(deps);
  return {
    runs,
    flows,
    store: deps.store,
    flowDefaults: new ResearchFlowDefaults(deps),
    runStats: new ResearchRunStats(deps.store),
    planActivity: new ResearchPlanActivity(deps.store),
    reportingQueries: new ResearchReportingQueries(deps.store),
    module: {
      name: 'research',
      register: (app) =>
        researchRoutes(app, { runs, flows, ...(deps.stopHook ? { stopHook: deps.stopHook } : {}) }),
    },
  };
}

/**
 * research: Research flows, runs, attempts, handoffs, the agent loop, guardrails and Settlement
 * (FR-18 to FR-22, FR-32 server side, FR-36 to FR-38). The api's side: routes and queries.
 */
export function createResearch(
  deps: ResearchCollaborators & { db: Database; queue: ResearchQueueDeps; testHooks?: boolean },
): Research {
  return assemble({
    ...deps,
    store: new KyselyResearchStore(deps.db, deps),
    monitor: new RedisQueueMonitor(deps.queue),
    ...(deps.testHooks ? { stopHook: new RedisStopHook(deps.queue) } : {}),
  });
}

/** research's reporting reads on MySQL alone (no queues or collaborators): reporting's tests. */
export function createResearchReportingQueries(deps: {
  db: Database;
  clock: Clock;
  ids: IdGenerator;
}): ResearchReportingQueries {
  return new ResearchReportingQueries(new KyselyResearchStore(deps.db, deps));
}

/** The same module on storage and fakes the caller provides (other modules' and HTTP tests). */
export function createResearchWith(deps: AssembleDeps): Research {
  return assemble(deps);
}

/**
 * Placeholder kept so composition.ts compiles until it registers `createResearch(...).module`
 * instead (it has no routes).
 */
export const researchModule = {
  name: 'research',
  register(_app: FastifyInstance): void {
    // Replaced by createResearch(...).module in the composition root.
  },
};

// Worker ------------------------------------------------------------------------------------------

/** Outbox events this module consumes, routed to its queues by the relay. */
export const researchSubscriptions: readonly OutboxSubscription[] = [
  { event: 'RunRequested', queue: RESEARCH_RUNS_QUEUE },
  { event: 'RunCompleted', queue: RESEARCH_EMAILS_QUEUE },
  { event: 'RunFailed', queue: RESEARCH_EMAILS_QUEUE },
];

export interface ResearchWorkerDeps {
  db: Database;
  connection: Redis;
  logger: Logger;
  /** Absent until the composition root wires research's collaborators: no workers then. */
  research?: ResearchCollaborators & {
    /** ENABLE_TEST_HOOKS and not production: the AJ-9 stop hook. */
    testHooks?: boolean;
    /** Unique per worker process (lease owner), e.g. `${hostname}:${pid}`. */
    workerId?: string;
    sleeper?: Sleeper;
    heartbeat?: Heartbeat;
    /**
     * Provider retries done by research's executor; default none, because the tools module's
     * ToolRunner already retries after 1 s, 4 s and 16 s (FR-20).
     */
    retryDelaysMs?: readonly number[];
    queue?: RunQueue;
    sweepEveryMs?: number;
  };
  prefix?: string;
}

const realSleeper: Sleeper = { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

/** This module's BullMQ workers (research-runs ×2, the sweeper every 30 s, run emails). */
export function registerResearchWorkers(deps: ResearchWorkerDeps): Worker[] {
  const r = deps.research;
  if (!r) {
    deps.logger.warn('research workers not started: collaborators not wired');
    return [];
  }
  const q = { connection: deps.connection, ...(deps.prefix ? { prefix: deps.prefix } : {}) };
  const store = new KyselyResearchStore(deps.db, r);
  const queue = r.queue ?? new BullRunQueue(q);
  const monitor = new RedisQueueMonitor(q);
  const executor = new RunExecutor({
    ...r,
    store,
    queue,
    sleeper: r.sleeper ?? realSleeper,
    retryDelaysMs: r.retryDelaysMs ?? [],
    heartbeat: r.heartbeat ?? intervalHeartbeat,
    workerId: r.workerId ?? `worker-${process.pid}`,
    logger: deps.logger,
    ...(r.testHooks ? { stopHook: new RedisStopHook(q) } : {}),
  });
  const sweeper = new RunSweeper({ ...r, store, queue, monitor, logger: deps.logger });
  const emails = new RunEmails({ ...r, store });
  return createResearchWorkers({
    ...q,
    executor,
    sweeper,
    emails,
    logger: deps.logger,
    ...(r.sweepEveryMs ? { sweepEveryMs: r.sweepEveryMs } : {}),
  });
}

// Demo data ---------------------------------------------------------------------------------------

/**
 * Demo data (PRD section 8a), idempotent: Flow template "Local buyers" v1 (default) and one
 * completed run of "Bakeries near Austin" for Sweet Supply Co (25 Leads, 137 credits; the Leads
 * are seeded by the leads module with `demo.runs.bakeriesNearAustin`). Runs before planning
 * seeds the Plan: modules share ids, not foreign keys.
 */
export async function seed(deps: {
  db: Database;
  clock?: Clock;
  ids?: IdGenerator;
  demo: ResearchDemoIds;
}): Promise<void> {
  const clock = deps.clock ?? new SystemClock();
  const ids = deps.ids ?? new Uuid7Generator();
  const store = new KyselyResearchStore(deps.db, { clock, ids });
  const flows = new FlowUseCases({
    store,
    clock,
    ids,
    settings: {
      ceilings: () => Promise.reject(new Error('unused')),
      support: () => Promise.reject(new Error('unused')),
    },
    audit: { record: () => Promise.resolve() },
  });
  await flows.ensureTemplate(LOCAL_BUYERS_V1, true);
  await seedDemoRun({ store, clock, ids, demo: deps.demo });
}
