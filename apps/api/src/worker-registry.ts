import type { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Config } from './config/env.js';
import { billingSubscriptions, registerBillingWorkers } from './modules/billing/index.js';
import { platformSubscriptions, registerPlatformWorkers } from './modules/platform/index.js';
import { registerResearchWorkers, researchSubscriptions } from './modules/research/index.js';
import type { Database } from './shared/infrastructure/db/database.js';
import {
  createOutboxRelayWorker,
  type OutboxSubscription,
} from './shared/infrastructure/outbox/index.js';
import { SystemClock } from './shared/infrastructure/time/system-clock.js';

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
];

/**
 * Every BullMQ worker the worker process runs: the outbox relay (every 2 s) and each module's
 * workers (research-runs, email, the run sweeper, event consumers).
 */
export function registerWorkers(deps: WorkerDeps): Worker[] {
  return [
    createOutboxRelayWorker({
      db: deps.db,
      connection: deps.connection,
      clock: new SystemClock(),
      logger: deps.logger,
      subscriptions: outboxSubscriptions,
    }),
    ...registerPlatformWorkers(deps),
    ...registerBillingWorkers(deps),
    ...registerResearchWorkers(deps),
  ];
}
