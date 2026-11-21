import type { FastifyInstance } from 'fastify';
import type { AnalyticsTracker } from '../../shared/application/analytics-tracker.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type { Database } from '../../shared/infrastructure/db/database.js';
import {
  AddExpensePrice,
  CreateExpense,
  DeleteExpense,
  DeleteExpensePrice,
  ListExpenses,
  UpdateExpense,
} from './application/expenses.js';
import { BudgetService, ExportPnlCsv, GetBudget, GetPnl, SaveBudget } from './application/pnl.js';
import type {
  FinanceAudit,
  FinanceContext,
  FinanceSources,
  FinanceStore,
} from './application/ports.js';
import {
  DeleteProviderInvoice,
  ListProviderInvoices,
  ListProviders,
  SaveProviderInvoice,
} from './application/provider-invoices.js';
import { financeRoutes, type FinanceUseCases } from './http/finance.routes.js';
import { KyselyFinanceStore } from './infrastructure/kysely-finance.js';
import { seedFinanceDemo } from './infrastructure/seed.js';

export type { FinanceTables } from './infrastructure/tables.js';
export type {
  BillingRevenue,
  FinanceAudit,
  FinanceAuditRecord,
  MemberDirectory,
  StaffDirectory,
  StaffRecipient,
  ToolsMetering,
} from './application/ports.js';
export type { MonthSpend } from './application/pnl.js';
export type { BudgetService } from './application/pnl.js';

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
 * identity's Staff recipients and Member emails, platform's Audit log and analytics.
 */
export interface FinanceDeps extends FinanceSources {
  db: Database;
  clock: Clock;
  ids: IdGenerator;
  audit: FinanceAudit;
  analytics: AnalyticsTracker;
}

export interface Finance {
  module: FinanceHttpModule;
  useCases: FinanceUseCases;
  /** Month-to-date spend vs the Budget (FR-11), for the budget alert job (FR-12). */
  budget: BudgetService;
  /** finance's tables (the budget alert job records alerts and snapshots through it). */
  store: FinanceStore;
}

/** Builds the module on any store (MySQL in production, in memory in tests). */
export function assembleFinance(ctx: FinanceContext): Finance {
  const useCases: FinanceUseCases = {
    listExpenses: new ListExpenses(ctx),
    createExpense: new CreateExpense(ctx),
    updateExpense: new UpdateExpense(ctx),
    addExpensePrice: new AddExpensePrice(ctx),
    deleteExpensePrice: new DeleteExpensePrice(ctx),
    deleteExpense: new DeleteExpense(ctx),
    listProviders: new ListProviders(ctx),
    listProviderInvoices: new ListProviderInvoices(ctx),
    saveProviderInvoice: new SaveProviderInvoice(ctx),
    deleteProviderInvoice: new DeleteProviderInvoice(ctx),
    getPnl: new GetPnl(ctx),
    exportPnlCsv: new ExportPnlCsv(ctx),
    getBudget: new GetBudget(ctx),
    saveBudget: new SaveBudget(ctx),
  };
  return {
    useCases,
    budget: new BudgetService(ctx),
    store: ctx.store,
    module: { name: 'finance', register: (app) => financeRoutes(app, useCases) },
  };
}

/**
 * finance: Expenses, Provider invoices, the P&L and the Budget (prd-expenses, ADR 0020). Staff
 * only. Charges, metered costs and the P&L are computed on read; nothing depends on finance.
 */
export function createFinance(deps: FinanceDeps): Finance {
  const { db, audit, ...rest } = deps;
  return assembleFinance({ ...rest, store: new KyselyFinanceStore(db, audit) });
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
