import type { Worker } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Database } from '../../shared/infrastructure/db/database.js';
import type { OutboxSubscription } from '../../shared/infrastructure/outbox/index.js';

/** billing: Credit wallet, ledger, Reservations, Credit packs and Stripe purchases (FR-10 to FR-13). */
export const billingModule = {
  name: 'billing',
  register(_app: FastifyInstance): void {
    // Routes arrive with this module's work package; they use @app/contracts/billing.
  },
};

/**
 * Demo data (PRD section 8a), called by scripts/seed.ts in dependency order. Never in production.
 * Will create: Credit packs Starter 2,500/$25, Growth 11,000/$100, Pro 30,000/$250; ledgers: Sweet Supply Co 863 available (grant 1,000, settlement 137 for the demo run), Clean Desk Co 50 (trial grant), Corner Coffee Roasters 120.
 */
export function seed(_deps: { db: Database }): Promise<void> {
  return Promise.resolve();
}

/** Outbox events this module consumes, routed to its queues by the relay. */
export const billingSubscriptions: readonly OutboxSubscription[] = [];

/** This module's BullMQ workers, started by worker-registry.ts. */
export function registerBillingWorkers(_deps: {
  db: Database;
  connection: Redis;
  logger: Logger;
}): Worker[] {
  return [];
}
