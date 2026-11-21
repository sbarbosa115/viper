import type { FastifyInstance } from 'fastify';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type { Database } from '../../shared/infrastructure/db/database.js';
import { seedFinanceDemo } from './infrastructure/seed.js';

export type { FinanceTables } from './infrastructure/tables.js';

/** The finance BullMQ queue (the daily `budget-check` job scheduler, FR-12). */
export const FINANCE_QUEUE = 'finance';

/** The HTTP module's shape (matches app.ts AppModule). */
export interface FinanceHttpModule {
  readonly name: 'finance';
  register(app: FastifyInstance): void;
}

/**
 * What finance needs from the composition root. Other contexts are reached only through ports
 * (prd-expenses section 7, module ports): billing's revenue, tools' metered cost and providers,
 * identity's Staff recipients, platform's Audit log, analytics and email. Added as the use
 * cases land.
 */
export interface FinanceDeps {
  db: Database;
  clock: Clock;
  ids: IdGenerator;
}

export interface Finance {
  module: FinanceHttpModule;
}

/**
 * finance: Expenses, Provider invoices, the P&L and the Budget (prd-expenses, ADR 0020). Staff
 * only. Charges, metered costs and the P&L are computed on read; nothing depends on finance.
 */
export function createFinance(_deps: FinanceDeps): Finance {
  return {
    module: {
      name: 'finance',
      register: (_app) => {
        // Routes land with the finance use cases (prd-expenses WP-1).
      },
    },
  };
}

/** Fixed ids the seed shares across modules (scripts/seed.ts `demo`). */
interface DemoIds {
  members: { staff: string };
}

/**
 * Demo data (prd-expenses section 8a), called by scripts/seed.ts after billing and tools. Never in
 * production. Idempotent: November 2026 bills and price versions, the One-off legal review,
 * Provider invoices (Anthropic, Google Maps Platform, ZeroBounce), the $300 Budget and the 80%
 * and 100% alerts recorded on 2026-11-12.
 */
export async function seed(deps: { db: Database; demo: DemoIds }): Promise<void> {
  await seedFinanceDemo(deps.db, deps.demo.members.staff);
}
