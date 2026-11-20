import type { Worker } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Database } from '../../shared/infrastructure/db/database.js';
import type { OutboxSubscription } from '../../shared/infrastructure/outbox/index.js';

/** platform: Platform settings with encrypted secrets, Audit log, analytics events, email sending (FR-7 to FR-9). */
export const platformModule = {
  name: 'platform',
  register(_app: FastifyInstance): void {
    // Routes arrive with this module's work package; they use @app/contracts/platform.
  },
};

/**
 * Demo data (PRD section 8a), called by scripts/seed.ts in dependency order. Never in production.
 * Will create: Platform settings: SMTP pointing at Mailpit, every provider key set to a fake value, default models, ceilings (1,000 credits, 500 leads, 120 active min, 4 h, 5 attempts, 50 trial credits), support email.
 */
export function seed(_deps: { db: Database }): Promise<void> {
  return Promise.resolve();
}

/** Outbox events this module consumes, routed to its queues by the relay. */
export const platformSubscriptions: readonly OutboxSubscription[] = [];

/** This module's BullMQ workers, started by worker-registry.ts. */
export function registerPlatformWorkers(_deps: {
  db: Database;
  connection: Redis;
  logger: Logger;
}): Worker[] {
  return [];
}
