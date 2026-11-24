import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type {
  OutboxMessage,
  OutboxSubscription,
} from '../../../shared/infrastructure/outbox/index.js';
import type { RunBudgetCheck, SendBudgetAlert } from '../application/budget-alerts.js';

/** The finance BullMQ queue (the daily `budget-check` job scheduler, FR-12). */
export const FINANCE_QUEUE = 'finance';
/** Outbox events finance consumes (the budget alert email, FR-12). */
export const FINANCE_EVENTS_QUEUE = 'finance-events';

/** Outbox events this module consumes, routed to its queue by the relay. */
export const financeSubscriptions: readonly OutboxSubscription[] = [
  { event: 'BudgetAlertRecorded', queue: FINANCE_EVENTS_QUEUE },
];

interface Logger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface FinanceWorkerDeps {
  /** `finance.budgetCheck` from createFinance. */
  budgetCheck: Pick<RunBudgetCheck, 'execute'>;
  connection: Redis;
  logger: Logger;
  prefix?: string;
}

/**
 * FR-12: runs the budget check daily at 14:00 UTC and once at start-up. The check only records
 * alerts and enqueues their email through the outbox; the events worker sends it.
 */
export function createFinanceWorker(deps: FinanceWorkerDeps): Worker {
  const prefix = deps.prefix ?? 'bull';
  const queue = new Queue(FINANCE_QUEUE, { connection: deps.connection, prefix });
  const jobOptions = { removeOnComplete: { age: 24 * 3600 }, removeOnFail: 100 };
  queue
    .upsertJobScheduler(
      'budget-check',
      { pattern: '0 14 * * *', tz: 'UTC' },
      { name: 'budget-check', opts: jobOptions },
    )
    // BullMQ ignores an add whose jobId already exists, so worker processes starting together
    // enqueue the start-up check once; after it completes (kept 24 h) a restart within the day
    // adds none. Either way the check is idempotent: a recorded alert is never emailed again.
    .then(() => queue.add('budget-check', {}, { ...jobOptions, jobId: 'budget-check-startup' }))
    .catch((err: unknown) => deps.logger.error({ err }, 'could not schedule the budget check'));
  const worker = new Worker(
    FINANCE_QUEUE,
    async () => {
      const sent = await deps.budgetCheck.execute();
      deps.logger.info({ sent }, 'budget check done');
      return { sent };
    },
    { connection: deps.connection, prefix, concurrency: 1 },
  );
  worker.on('failed', (_job, err) => deps.logger.warn({ err }, 'budget check failed'));
  worker.on('closed', () => void queue.close());
  return worker;
}

/** The recipients already emailed, kept in the job's progress across BullMQ retries. */
function deliveredOf(job: Job): string[] {
  const p = job.progress as { delivered?: unknown } | number | undefined;
  return typeof p === 'object' && Array.isArray(p.delivered)
    ? p.delivered.filter((d): d is string => typeof d === 'string')
    : [];
}

/**
 * FR-12, G-3: on `BudgetAlertRecorded` sends the alert email; a failed send fails the job so the
 * relay's retry options (5 tries, exponential backoff) try again. The job id is the event id, so
 * a re-relay does not duplicate it, and recipients already emailed are skipped on a retry.
 */
export function createBudgetAlertWorker(deps: {
  sendBudgetAlert: Pick<SendBudgetAlert, 'execute'>;
  connection: Redis;
  logger: Logger;
  prefix?: string;
}): Worker {
  const worker = new Worker<OutboxMessage>(
    FINANCE_EVENTS_QUEUE,
    async (job: Job<OutboxMessage>) => {
      const message = job.data;
      if (message.type !== 'BudgetAlertRecorded') return;
      const payload = message.payload as OutboxMessage<'BudgetAlertRecorded'>['payload'];
      await deps.sendBudgetAlert.execute(payload, {
        delivered: deliveredOf(job),
        save: (delivered) => job.updateProgress({ delivered: [...delivered] }),
      });
    },
    { connection: deps.connection, ...(deps.prefix ? { prefix: deps.prefix } : {}) },
  );
  worker.on('failed', (job, err) =>
    deps.logger.warn({ err, jobId: job?.id, attempts: job?.attemptsMade }, 'budget alert failed'),
  );
  return worker;
}

/** finance's BullMQ workers, started by worker-registry.ts: the daily check and its emails. */
export function registerFinanceWorkers(deps: {
  finance: {
    budgetCheck: Pick<RunBudgetCheck, 'execute'>;
    sendBudgetAlert: Pick<SendBudgetAlert, 'execute'>;
  };
  connection: Redis;
  logger: Logger;
  prefix?: string;
}): Worker[] {
  const common = {
    connection: deps.connection,
    logger: deps.logger,
    ...(deps.prefix ? { prefix: deps.prefix } : {}),
  };
  return [
    createFinanceWorker({ ...common, budgetCheck: deps.finance.budgetCheck }),
    createBudgetAlertWorker({ ...common, sendBudgetAlert: deps.finance.sendBudgetAlert }),
  ];
}
