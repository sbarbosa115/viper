import type { FastifyInstance } from 'fastify';
import type { Database } from '../../shared/infrastructure/db/database.js';

/** reporting: Read-only Staff dashboard and customer list (FR-30, FR-31). */
export const reportingModule = {
  name: 'reporting',
  register(_app: FastifyInstance): void {
    // Routes arrive with this module's work package; they use @app/contracts/reporting.
  },
};

/**
 * Demo data (PRD section 8a), called by scripts/seed.ts in dependency order. Never in production.
 * Will create: Nothing: reporting reads other modules.
 */
export function seed(_deps: { db: Database }): Promise<void> {
  return Promise.resolve();
}
