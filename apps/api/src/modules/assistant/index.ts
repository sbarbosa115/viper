import type { FastifyInstance } from 'fastify';
import type { Database } from '../../shared/infrastructure/db/database.js';

/** assistant: Welcome Conversation that builds the Business Profile (FR-14). */
export const assistantModule = {
  name: 'assistant',
  register(_app: FastifyInstance): void {
    // Routes arrive with this module's work package; they use @app/contracts/assistant.
  },
};

/**
 * Demo data (PRD section 8a), called by scripts/seed.ts in dependency order. Never in production.
 * Will create: Nothing: conversations start empty.
 */
export function seed(_deps: { db: Database }): Promise<void> {
  return Promise.resolve();
}
