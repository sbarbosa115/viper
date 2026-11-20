import type { FastifyInstance } from 'fastify';
import type { Database } from '../../shared/infrastructure/db/database.js';

/** identity: Businesses, Members, sessions, Staff two-factor and Acting as (FR-1 to FR-6). */
export const identityModule = {
  name: 'identity',
  register(_app: FastifyInstance): void {
    // Routes arrive with this module's work package; they use @app/contracts/identity.
  },
};

/**
 * Demo data (PRD section 8a), called by scripts/seed.ts in dependency order. Never in production.
 * Will create: Members and Businesses: owner@demo.test (Sweet Supply Co, verified), new@demo.test (Clean Desk Co, verified), low@demo.test (Corner Coffee Roasters, verified), staff@demo.test (Staff, Business "Llyner Leads (internal)" marked internal, TOTP secret JBSWY3DPEHPK3PXP); password demo1234 for all.
 */
export function seed(_deps: { db: Database }): Promise<void> {
  return Promise.resolve();
}
