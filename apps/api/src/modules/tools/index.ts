import type { FastifyInstance } from 'fastify';
import type { Database } from '../../shared/infrastructure/db/database.js';

/** tools: Tool catalog, Rate card, ToolRunner metering and provider adapters (FR-23, FR-24). */
export const toolsModule = {
  name: 'tools',
  register(_app: FastifyInstance): void {
    // Routes arrive with this module's work package; they use @app/contracts/tools.
  },
};

/**
 * Demo data (PRD section 8a), called by scripts/seed.ts in dependency order. Never in production.
 * Will create: Every Tool with the seeded Rate card (>= 60% margin), enabled; fake adapters serve fixtures when TOOLS_MODE=fake.
 */
export function seed(_deps: { db: Database }): Promise<void> {
  return Promise.resolve();
}
