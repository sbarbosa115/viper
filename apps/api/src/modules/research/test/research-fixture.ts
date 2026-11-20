import type { Ceilings } from '@app/contracts/platform';
import type { Actor } from '../../../shared/domain/actor.js';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { InMemoryEmailSender } from '../../../shared/infrastructure/email/in-memory-email-sender.js';
import { ScriptedLlmClient } from '../../../shared/infrastructure/llm/scripted-llm-client.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import { createInMemoryBilling } from '../../billing/index.js';
import { FlowUseCases } from '../application/flows.js';
import type {
  AuditPort,
  IdentityPort,
  PlanSnapshotsPort,
  PlatformSettingsPort,
  QueueCounts,
  QueueMonitor,
  RunQueue,
  Sleeper,
  StopHook,
} from '../application/ports.js';
import { RunExecutor, type AttemptResult, type ExecutorDeps } from '../application/run-executor.js';
import { RunEmails } from '../application/run-emails.js';
import { RunUseCases } from '../application/runs.js';
import { RunSweeper } from '../application/sweeper.js';
import { LOCAL_BUYERS_V1 } from '../domain/local-buyers.js';
import { fakeResearchAgent } from '../infrastructure/fake-research-agent.js';
import { InMemoryResearchStore } from '../infrastructure/in-memory-research-store.js';
import { FakeToolRunner } from './fake-tool-runner.js';
import { InMemoryProspectStore } from './in-memory-prospect-store.js';

export const BUSINESS = '00000000-0000-7000-8000-00000000b001';
export const OTHER_BUSINESS = '00000000-0000-7000-8000-00000000b002';
export const PLAN = '00000000-0000-7000-8000-00000000e001';
export const OWNER_ID = '00000000-0000-7000-8000-00000000c001';
export const STAFF_ID = '00000000-0000-7000-8000-00000000c002';
export const CANE_SUGAR = '00000000-0000-7000-8000-00000000f001';
export const SEGMENT_BAKERIES = '00000000-0000-7000-8000-00000000f101';
export const SEGMENT_CAFES = '00000000-0000-7000-8000-00000000f102';
export const UNKNOWN_ID = '00000000-0000-7000-8000-0000000fffff';
export const START = new Date('2026-11-19T10:00:00.000Z');

export function owner(overrides: Partial<Actor> = {}): Actor {
  return {
    memberId: OWNER_ID,
    businessId: BUSINESS,
    roles: ['owner'],
    emailVerified: true,
    ...overrides,
  };
}

export function staff(overrides: Partial<Actor> = {}): Actor {
  return {
    memberId: STAFF_ID,
    businessId: '00000000-0000-7000-8000-00000000b0ff',
    roles: ['owner', 'staff'],
    emailVerified: true,
    ...overrides,
  };
}

export function actingAs(): Actor {
  return staff({
    businessId: BUSINESS,
    actingAs: { businessId: BUSINESS, businessName: 'Sweet Supply Co', staffMemberId: STAFF_ID },
  });
}

type PlanForRun = NonNullable<Awaited<ReturnType<PlanSnapshotsPort['getPlanSnapshot']>>>;

export function bakeriesPlan(overrides: Partial<PlanForRun> = {}): PlanForRun {
  return {
    id: PLAN,
    businessId: BUSINESS,
    flowKey: 'local-buyers',
    name: 'Bakeries near Austin',
    goal: 'Bakeries within 3 miles that could buy our cane sugar',
    segments: [
      {
        id: SEGMENT_BAKERIES,
        name: 'Bakeries',
        fitSignals: ['Bakes on site'],
        exclusions: ['Chains'],
        productId: CANE_SUGAR,
      },
      {
        id: SEGMENT_CAFES,
        name: 'Cafés that bake',
        fitSignals: ['Pastry case'],
        exclusions: [],
        productId: CANE_SUGAR,
      },
    ],
    searchArea: {
      label: '1200 E 6th St, Austin, TX 78702',
      lat: 30.2624,
      lng: -97.7262,
      radiusMiles: 3,
    },
    guardrails: { maxCredits: 400, maxLeads: 10, minFitScore: 60 },
    icpEdited: false,
    ...overrides,
  };
}

export class FakePlans implements PlanSnapshotsPort {
  readonly plans = new Map<string, PlanForRun>([[PLAN, bakeriesPlan()]]);
  getPlanSnapshot(businessId: string, planId: string): Promise<PlanForRun | null> {
    const plan = this.plans.get(planId);
    return Promise.resolve(plan?.businessId === businessId ? structuredClone(plan) : null);
  }
}

export class FakeIdentity implements IdentityPort {
  getOwnerContact(businessId: string) {
    return Promise.resolve(
      businessId === BUSINESS ? { email: 'owner@demo.test', name: 'Sam' } : null,
    );
  }
  getBusinesses(ids: readonly string[]) {
    return Promise.resolve(
      ids.map((id) => ({ id, name: id === BUSINESS ? 'Sweet Supply Co' : 'Other Co' })),
    );
  }
}

export const TEST_CEILINGS: Ceilings = {
  maxCredits: 1_000,
  maxLeads: 500,
  maxActiveMinutes: 120,
  maxTotalHours: 4,
  maxAttempts: 5,
  trialCredits: 50,
};

export class FakeSettings implements PlatformSettingsPort {
  ceilingValues: Ceilings = { ...TEST_CEILINGS };
  supportEmail: string | null = 'support@llyner.test';
  ceilings() {
    return Promise.resolve({ ...this.ceilingValues });
  }
  support() {
    return Promise.resolve({ supportEmail: this.supportEmail });
  }
}

export class RecordingQueue implements RunQueue {
  readonly jobs: { runId: string; attemptN: number; delayMs: number }[] = [];
  enqueue(runId: string, options: { attemptN: number; delayMs: number }): Promise<void> {
    this.jobs.push({ runId, ...options });
    return Promise.resolve();
  }
}

export class FakeMonitor implements QueueMonitor {
  counts: () => Promise<QueueCounts> = () =>
    Promise.resolve({ waiting: 1, active: 2, failed: 0, delayed: 1 });
  lastSweep: { at: Date; stalled: number } | null = null;
  total = 0;
  sweeperStatus() {
    return Promise.resolve({ lastRunAt: this.lastSweep?.at ?? null, stalledFound: this.total });
  }
  recordSweep(at: Date, stalledFound: number) {
    this.lastSweep = { at, stalled: stalledFound };
    this.total += stalledFound;
    return Promise.resolve();
  }
  workerLastSeenAt() {
    return Promise.resolve(new Date('2026-11-19T09:59:30.000Z'));
  }
}

/** Records waits and moves the clock forward by them (backoff, FR-20). */
export class ClockSleeper implements Sleeper {
  readonly waits: number[] = [];
  constructor(private readonly clock: FixedClock) {}
  sleep(ms: number): Promise<void> {
    this.waits.push(ms);
    this.clock.set(new Date(this.clock.now().getTime() + ms));
    return Promise.resolve();
  }
}

export class RecordingAudit implements AuditPort {
  readonly entries: Parameters<AuditPort['record']>[0][] = [];
  record(entry: Parameters<AuditPort['record']>[0], _within?: object): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

/** Collects warnings (the sweeper's and the heartbeat's). */
export class RecordingLogger {
  readonly warnings: { obj: object; msg: string }[] = [];
  warn(obj: object, msg: string): void {
    this.warnings.push({ obj, msg });
  }
}

export class MemoryStopHook implements StopHook {
  hook: { stepKey: string; items: number } | null = null;
  take() {
    const h = this.hook;
    this.hook = null;
    return Promise.resolve(h);
  }
  set(hook: { stepKey: string; items: number }) {
    this.hook = hook;
    return Promise.resolve();
  }
}

/** research's use cases, executor and sweeper on in-memory storage and fakes. */
export async function researchFixture(options: { credits?: number } = {}) {
  const clock = new FixedClock(START);
  const ids = new SequentialIdGenerator();
  const store = new InMemoryResearchStore();
  const billing = createInMemoryBilling({ clock, ids });
  const llm = new ScriptedLlmClient(fakeResearchAgent);
  const tools = new FakeToolRunner(clock, llm);
  const prospects = new InMemoryProspectStore();
  const analytics = new RecordingAnalyticsTracker();
  const plans = new FakePlans();
  const identity = new FakeIdentity();
  const settings = new FakeSettings();
  const queue = new RecordingQueue();
  const monitor = new FakeMonitor();
  const sleeper = new ClockSleeper(clock);
  const audit = new RecordingAudit();
  const stopHook = new MemoryStopHook();
  const email = new InMemoryEmailSender();

  const flows = new FlowUseCases({ store, settings, audit, clock, ids });
  await flows.ensureTemplate(LOCAL_BUYERS_V1, true);
  const runs = new RunUseCases({
    store,
    billing: billing.billingCommands,
    plans,
    catalog: tools,
    identity,
    toolCalls: tools,
    monitor,
    audit,
    clock,
    ids,
    analytics,
  });
  const logger = new RecordingLogger();
  const makeExecutor = (
    workerId = 'worker-1',
    extra: Partial<Pick<ExecutorDeps, 'heartbeat'>> = {},
  ) =>
    new RunExecutor({
      // A call still running at shutdown gets 20 ms (10 s in the worker).
      shutdownGraceMs: 20,
      ...extra,
      store,
      tools,
      catalog: tools,
      prospects,
      billing: billing.billingCommands,
      clock,
      ids,
      sleeper,
      analytics,
      queue,
      workerId,
      stopHook,
    });
  const executor = makeExecutor();
  const sweeper = new RunSweeper({
    store,
    billing: billing.billingCommands,
    queue,
    monitor,
    clock,
    analytics,
    logger,
  });
  const emails = new RunEmails({
    store,
    email,
    identity,
    settings,
    clock,
    appUrl: 'http://localhost:5173',
  });

  if (options.credits !== 0) {
    await billing.application.adjustCredits.apply({
      businessId: BUSINESS,
      credits: options.credits ?? 1_000,
      reason: 'Test credits',
      memberId: STAFF_ID,
      idempotencyKey: `test:${BUSINESS}`,
    });
  }

  const advance = (ms: number) => clock.set(new Date(clock.now().getTime() + ms));
  const available = async () => (await billing.billingQueries.getWallet(BUSINESS)).available;

  /** Runs attempts until the run finishes, moving the clock to each retry (max 10). */
  async function runToEnd(runId: string, exec: RunExecutor = executor): Promise<AttemptResult[]> {
    const results: AttemptResult[] = [];
    for (let i = 0; i < 10; i += 1) {
      const run = store.run(runId);
      if (!run || run.isFinished) break;
      const next = run.toSnapshot().nextAttemptAt;
      if (next && next > clock.now()) clock.set(next);
      results.push(await exec.runAttempt(runId));
    }
    return results;
  }

  return {
    clock,
    ids,
    store,
    billing,
    tools,
    prospects,
    llm,
    analytics,
    plans,
    identity,
    settings,
    queue,
    monitor,
    sleeper,
    audit,
    stopHook,
    email,
    flows,
    runs,
    executor,
    makeExecutor,
    sweeper,
    emails,
    logger,
    advance,
    available,
    runToEnd,
  };
}

export type ResearchFixture = Awaited<ReturnType<typeof researchFixture>>;
