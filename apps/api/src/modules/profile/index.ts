import type { FastifyInstance } from 'fastify';
import type { Database } from '../../shared/infrastructure/db/database.js';

/** profile: Business Profile and Products (FR-14, FR-15). */
export const profileModule = {
  name: 'profile',
  register(_app: FastifyInstance): void {
    // Routes arrive with this module's work package; they use @app/contracts/profile.
  },
};

/**
 * Demo data (PRD section 8a), called by scripts/seed.ts in dependency order. Never in production.
 * Will create: Profiles: Sweet Supply Co (Austin TX, cane sugar + powdered sugar, 3 miles, complete), Corner Coffee Roasters (complete); Clean Desk Co stays empty (welcome chat start).
 */
export function seed(_deps: { db: Database }): Promise<void> {
  return Promise.resolve();
}
