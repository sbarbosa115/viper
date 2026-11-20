import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type {
  Heartbeat,
  QueueCounts,
  QueueMonitor,
  RunQueue,
  StopHook,
} from '../application/ports.js';
import type { RunExecutor } from '../application/run-executor.js';
import type { RunEmails, RunEventMessage } from '../application/run-emails.js';
import type { RunSweeper } from '../application/sweeper.js';

/** BullMQ queues of the research module (ADR 0008, PRD section 9). */
export const RESEARCH_RUNS_QUEUE = 'research-runs';
export const RESEARCH_EMAILS_QUEUE = 'research-emails';
export const RESEARCH_SWEEPER_QUEUE = 'research-sweeper';
/** Two runs execute at once on one worker (NFR-3). */
export const RESEARCH_RUNS_CONCURRENCY = 2;
export const SWEEP_EVERY_MS = 30_000;
/** Written by worker.ts every 30 s. */
export const WORKER_HEARTBEAT_KEY = 'worker:heartbeat';
const SWEEPER_KEY = 'research:sweeper';
const STOP_HOOK_KEY = 'research:test:stop-after';

interface QueueOptions {
  connection: Redis;
  /** BullMQ key prefix (tests isolate themselves with their own). */
  prefix?: string;
}

const prefixed = (o: QueueOptions) => ({
  connection: o.connection,
  ...(o.prefix ? { prefix: o.prefix } : {}),
});

/** The research-runs queue: one job per run attempt, de-duplicated by run and attempt number. */
export class BullRunQueue implements RunQueue {
  private readonly queue: Queue;

  constructor(options: QueueOptions) {
    this.queue = new Queue(RESEARCH_RUNS_QUEUE, prefixed(options));
  }

  async enqueue(runId: string, options: { attemptN: number; delayMs: number }): Promise<void> {
    await this.queue.add(
      'attempt',
      { runId },
      {
        jobId: `run-${runId}-${options.attemptN}`,
        delay: Math.max(0, options.delayMs),
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    );
  }

  close(): Promise<void> {
    return this.queue.close();
  }
}

/** Queue health for Staff (FR-32): BullMQ counts, the sweeper's last run, the worker heartbeat. */
export class RedisQueueMonitor implements QueueMonitor {
  private readonly queue: Queue;

  constructor(private readonly options: QueueOptions) {
    this.queue = new Queue(RESEARCH_RUNS_QUEUE, prefixed(options));
  }

  async counts(): Promise<QueueCounts> {
    const c = await this.queue.getJobCounts('waiting', 'active', 'failed', 'delayed');
    return {
      waiting: c.waiting ?? 0,
      active: c.active ?? 0,
      failed: c.failed ?? 0,
      delayed: c.delayed ?? 0,
    };
  }

  async sweeperStatus(): Promise<{ lastRunAt: Date | null; stalledFound: number }> {
    const h = await this.options.connection.hgetall(this.key(SWEEPER_KEY));
    return {
      lastRunAt: h.lastRunAt ? new Date(h.lastRunAt) : null,
      stalledFound: Number(h.stalledFound ?? 0),
    };
  }

  async recordSweep(at: Date, stalledFound: number): Promise<void> {
    await this.options.connection
      .multi()
      .hset(this.key(SWEEPER_KEY), 'lastRunAt', at.toISOString())
      .hincrby(this.key(SWEEPER_KEY), 'stalledFound', stalledFound)
      .exec();
  }

  async workerLastSeenAt(): Promise<Date | null> {
    const at = await this.options.connection.get(WORKER_HEARTBEAT_KEY);
    return at ? new Date(at) : null;
  }

  close(): Promise<void> {
    return this.queue.close();
  }

  private key(k: string): string {
    return this.options.prefix ? `${this.options.prefix}:${k}` : k;
  }
}

/** Test-only (ENABLE_TEST_HOOKS, AJ-9): the api sets it, the worker takes it once. */
export class RedisStopHook implements StopHook {
  constructor(private readonly options: QueueOptions) {}

  async take(): Promise<{ stepKey: string; items: number } | null> {
    const raw = await this.options.connection.getdel(this.key());
    return raw ? (JSON.parse(raw) as { stepKey: string; items: number }) : null;
  }

  async set(hook: { stepKey: string; items: number }): Promise<void> {
    await this.options.connection.set(this.key(), JSON.stringify(hook), 'EX', 3600);
  }

  private key(): string {
    return this.options.prefix ? `${this.options.prefix}:${STOP_HOOK_KEY}` : STOP_HOOK_KEY;
  }
}

/**
 * Renews an attempt's lease on a timer (FR-36). A failed renewal is logged, never swallowed: the
 * next beat tries again before the lease runs out.
 */
export function intervalHeartbeat(logger: { warn(obj: object, msg: string): void }): Heartbeat {
  return {
    start(beat, everyMs) {
      const timer = setInterval(() => {
        beat().catch((err: unknown) => logger.warn({ err }, 'research lease renewal failed'));
      }, everyMs);
      return () => clearInterval(timer);
    },
  };
}

/**
 * BullMQ's own job lock outlives the shortest lease (5 min): a run's liveness is the lease the
 * sweeper checks, not BullMQ's stalled-job detection (maxStalledCount 0).
 */
export const RESEARCH_RUN_LOCK_MS = 5 * 60_000;

/** The run id of a research-runs job: an outbox `RunRequested` or an `attempt` job. */
export function runIdOf(job: Pick<Job, 'name' | 'data'>): string | null {
  const data = job.data as { runId?: unknown; payload?: { runId?: unknown } };
  const id = job.name === 'RunRequested' ? data.payload?.runId : data.runId;
  return typeof id === 'string' ? id : null;
}

export interface ResearchWorkersDeps extends QueueOptions {
  executor: RunExecutor;
  sweeper: RunSweeper;
  emails: RunEmails;
  logger: Logger;
  sweepEveryMs?: number;
}

/**
 * The research workers (PRD section 9): `research-runs` (concurrency 2), the run sweeper every
 * 30 s, and run emails from the outbox. A crashed worker's job is not re-run by BullMQ
 * (maxStalledCount 0): the sweeper ends the attempt when its lease expires and queues the next.
 */
export function createResearchWorkers(deps: ResearchWorkersDeps): Worker[] {
  const opts = prefixed(deps);
  // Closing the worker (SIGTERM) aborts the attempts in flight: each stops at its next save, or
  // after a short grace if a Tool call is running, and ends as a retryable `worker_stopped`.
  const shutdown = new AbortController();
  const runs = new Worker(
    RESEARCH_RUNS_QUEUE,
    async (job: Job) => {
      const runId = runIdOf(job);
      if (!runId) return 'invalid';
      return deps.executor.runAttempt(runId, { signal: shutdown.signal });
    },
    {
      ...opts,
      concurrency: RESEARCH_RUNS_CONCURRENCY,
      maxStalledCount: 0,
      lockDuration: RESEARCH_RUN_LOCK_MS,
    },
  );
  runs.on('closing', () => shutdown.abort());
  runs.on('failed', (job, err) =>
    deps.logger.warn({ err, jobId: job?.id }, 'research run job failed'),
  );

  const scheduler = new Queue(RESEARCH_SWEEPER_QUEUE, opts);
  scheduler
    .upsertJobScheduler(
      'research-sweeper',
      { every: deps.sweepEveryMs ?? SWEEP_EVERY_MS },
      { name: 'sweep', opts: { removeOnComplete: true, removeOnFail: 100 } },
    )
    .catch((err: unknown) => deps.logger.error({ err }, 'could not schedule the run sweeper'));
  const sweeper = new Worker(RESEARCH_SWEEPER_QUEUE, () => deps.sweeper.sweep(), {
    ...opts,
    concurrency: 1,
  });
  sweeper.on('failed', (_job, err) => deps.logger.warn({ err }, 'run sweeper failed'));
  sweeper.on('closed', () => void scheduler.close());

  const emails = new Worker(
    RESEARCH_EMAILS_QUEUE,
    (job: Job<RunEventMessage>) => deps.emails.handle(job.data),
    opts,
  );
  emails.on('failed', (job, err) =>
    deps.logger.warn({ err, jobId: job?.id, attempts: job?.attemptsMade }, 'run email failed'),
  );
  return [runs, sweeper, emails];
}
