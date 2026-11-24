import { hostname } from 'node:os';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { composeModules } from './composition.js';
import type { Config } from './config/env.js';
import { billingSubscriptions, registerBillingWorkers } from './modules/billing/index.js';
import { platformSubscriptions, registerPlatformWorkers } from './modules/platform/index.js';
import {
  purgeOldMessages,
  registerResearchWorkers,
  researchSubscriptions,
} from './modules/research/index.js';
import { financeSubscriptions, registerFinanceWorkers } from './modules/finance/index.js';
import { registerSupportWorkers, supportSubscriptions } from './modules/support/index.js';
import { createIdentitySupportQueries } from './modules/identity/index.js';
import { createResearchSupportQueries } from './modules/research/index.js';
import type { Clock } from './shared/domain/clock.js';
import type { Database } from './shared/infrastructure/db/database.js';
import {
  createOutboxRelayWorker,
  type OutboxSubscription,
} from './shared/infrastructure/outbox/index.js';

export interface WorkerDeps {
  config: Config;
  db: Database;
  connection: Redis;
  logger: Logger;
}

/** Which module queues receive which outbox events. */
export const outboxSubscriptions: readonly OutboxSubscription[] = [
  ...platformSubscriptions,
  ...billingSubscriptions,
  ...researchSubscriptions,
  ...financeSubscriptions,
  ...supportSubscriptions,
];

export const MAINTENANCE_QUEUE = 'maintenance';
const DAY_MS = 24 * 3600 * 1000;

/** Daily housekeeping: research's run messages older than 90 days are deleted (FR-36). */
export function createMaintenanceWorker(deps: {
  db: Database;
  connection: Redis;
  clock: Clock;
  logger: Logger;
  prefix?: string;
}): Worker {
  const prefix = deps.prefix ?? 'bull';
  const scheduler = new Queue(MAINTENANCE_QUEUE, { connection: deps.connection, prefix });
  scheduler
    .upsertJobScheduler(
      'purge-run-messages',
      { every: DAY_MS },
      { name: 'purge-run-messages', opts: { removeOnComplete: true, removeOnFail: 100 } },
    )
    .catch((err: unknown) => deps.logger.error({ err }, 'could not schedule maintenance'));
  const worker = new Worker(
    MAINTENANCE_QUEUE,
    async () => {
      const deleted = await purgeOldMessages(deps.db, deps.clock.now());
      deps.logger.info({ deleted }, 'purged old run messages');
      return { deleted };
    },
    { connection: deps.connection, prefix, concurrency: 1 },
  );
  worker.on('failed', (_job, err) => deps.logger.warn({ err }, 'maintenance job failed'));
  worker.on('closed', () => void scheduler.close());
  return worker;
}

/** The worker process's workers, and a close for what they share (the SMTP pool). */
export interface RegisteredWorkers {
  workers: Worker[];
  /** Closes the shared email sender's SMTP connections; call it after the workers close. */
  close(): void;
}

/**
 * Every BullMQ worker the worker process runs: the outbox relay (every 2 s), each module's
 * workers (research-runs ×2, the run sweeper, run emails, event consumers) and daily maintenance.
 * Research uses the same collaborators as the api (composeModules), including the fake Tools'
 * error modes over the same Valkey.
 */
export function registerWorkers(deps: WorkerDeps): RegisteredWorkers {
  const modules = composeModules(deps.config, {
    db: deps.db,
    logger: deps.logger,
    redis: deps.connection,
  });
  const { core } = modules;
  const workers = [
    createOutboxRelayWorker({
      db: deps.db,
      connection: deps.connection,
      clock: core.clock,
      logger: deps.logger,
      subscriptions: outboxSubscriptions,
    }),
    ...registerPlatformWorkers(deps),
    ...registerBillingWorkers({ ...deps, trialCredits: core.trialCredits }),
    ...registerResearchWorkers({
      db: deps.db,
      connection: deps.connection,
      logger: deps.logger,
      research: {
        ...modules.researchCollaborators,
        workerId: `${hostname()}:${process.pid}`,
      },
    }),
    createMaintenanceWorker({
      db: deps.db,
      connection: deps.connection,
      clock: core.clock,
      logger: deps.logger,
    }),
    ...registerFinanceWorkers({
      finance: modules.finance,
      connection: deps.connection,
      logger: deps.logger,
    }),
    ...registerSupportWorkers({
      store: modules.support.store,
      identity: createIdentitySupportQueries({ db: deps.db, clock: core.clock, ids: core.ids }),
      research: createResearchSupportQueries({ db: deps.db, clock: core.clock, ids: core.ids }),
      email: modules.email,
      appUrl: deps.config.APP_URL,
      logger: deps.logger,
      connection: deps.connection,
    }),
  ];
  return { workers, close: () => modules.email.close() };
}

/**
 * Graceful stop: waits up to `closeWaitMs` for the workers to finish their jobs, then force-closes
 * the ones still busy (their leases expire and the sweeper resumes them), and only then closes the
 * shared email sender, so a run email being sent is not cut off.
 */
export async function stopWorkers(
  registered: { workers: readonly Pick<Worker, 'close'>[]; close(): void },
  options: { closeWaitMs: number; logger: Pick<Logger, 'warn'> },
): Promise<void> {
  const { workers } = registered;
  const closed = Promise.allSettled(workers.map((w) => w.close())).then(() => 'closed' as const);
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), options.closeWaitMs);
    timer.unref();
  });
  const outcome = await Promise.race([closed, late]);
  clearTimeout(timer);
  if (outcome === 'late') {
    options.logger.warn('workers still busy at the shutdown deadline; closing them now');
    await Promise.allSettled(workers.map((w) => w.close(true)));
  }
  try {
    registered.close();
  } catch (err) {
    options.logger.warn({ err }, 'could not close the email sender');
  }
}
