import type { FastifyInstance } from 'fastify';
import type { Database } from '../../shared/infrastructure/db/database.js';

/** leads: Prospects, Leads, Contacts, Sources, Evidence, Feedback and CSV export (FR-25 to FR-28). */
export const leadsModule = {
  name: 'leads',
  register(_app: FastifyInstance): void {
    // Routes arrive with this module's work package; they use @app/contracts/leads.
  },
};

/**
 * Demo data (PRD section 8a), called by scripts/seed.ts in dependency order. Never in production.
 * Will create: 25 Leads for the demo run built from the fake-Tool fixtures (mixed Fit scores, Feedback on 5), each contact and Evidence item with a Source.
 */
export function seed(_deps: { db: Database }): Promise<void> {
  return Promise.resolve();
}
