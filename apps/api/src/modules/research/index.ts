import type { Worker } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Database } from '../../shared/infrastructure/db/database.js';
import type { OutboxSubscription } from '../../shared/infrastructure/outbox/index.js';

/** research: Research flows, runs, attempts, handoffs, the agent loop, guardrails and settlement (FR-18 to FR-22, FR-36 to FR-38). */
export const researchModule = {
  name: 'research',
  register(_app: FastifyInstance): void {
    // Routes arrive with this module's work package; they use @app/contracts/research.
  },
};

/**
 * Demo data (PRD section 8a), called by scripts/seed.ts in dependency order. Never in production.
 * Will create: Flow template "Local buyers" v1 (default); one completed run of "Bakeries near Austin" (137 credits, 25 Leads) using demo.plans/demo.runs ids, so it can be written before planning seeds the Plan.
 */
export function seed(_deps: { db: Database }): Promise<void> {
  return Promise.resolve();
}

/** Outbox events this module consumes, routed to its queues by the relay. */
export const researchSubscriptions: readonly OutboxSubscription[] = [];

/** This module's BullMQ workers, started by worker-registry.ts. */
export function registerResearchWorkers(_deps: {
  db: Database;
  connection: Redis;
  logger: Logger;
}): Worker[] {
  return [];
}
