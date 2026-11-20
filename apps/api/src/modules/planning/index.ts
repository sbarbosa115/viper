import type { FastifyInstance } from 'fastify';
import type { Database } from '../../shared/infrastructure/db/database.js';

/** planning: Plans: Goal, Ideal Customer Profile, Search area, Guardrails, estimate (FR-16, FR-17). */
export const planningModule = {
  name: 'planning',
  register(_app: FastifyInstance): void {
    // Routes arrive with this module's work package; they use @app/contracts/planning.
  },
};

/**
 * Demo data (PRD section 8a), called by scripts/seed.ts in dependency order. Never in production.
 * Will create: Plans: "Bakeries near Austin" for Sweet Supply Co (max credits 400), one Plan for Corner Coffee Roasters (max credits 400, AJ-4).
 */
export function seed(_deps: { db: Database }): Promise<void> {
  return Promise.resolve();
}
