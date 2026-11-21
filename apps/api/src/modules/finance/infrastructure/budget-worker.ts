import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { RunBudgetCheck } from '../application/budget-alerts.js';

/** The finance BullMQ queue (the daily `budget-check` job scheduler, FR-12). */
export const FINANCE_QUEUE = 'finance';

export interface FinanceWorkerDeps {
  /** `finance.budgetCheck` from createFinance. */
  budgetCheck: Pick<RunBudgetCheck, 'execute'>;
  connection: Redis;
  logger: {
    info(obj: object, msg: string): void;
    warn(obj: object, msg: string): void;
    error(obj: object, msg: string): void;
  };
  prefix?: string;
}

/**
 * FR-12: runs the budget check daily at 14:00 UTC and once at start-up. The start-up job has a
 * fixed jobId, so several workers starting together enqueue it once; the check itself is
 * idempotent (a recorded alert is never sent again).
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
