import type { FastifyInstance } from 'fastify';
import type { EmailSender } from '../../shared/application/email-sender.js';
import type { AnalyticsTracker } from '../../shared/application/analytics-tracker.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type { Database } from '../../shared/infrastructure/db/database.js';
import type { AlertLogger } from './application/budget-alerts.js';
import { KyselyOutbox } from '../../shared/infrastructure/outbox/index.js';
import {
  AddExpensePrice,
  CreateExpense,
  DeleteExpense,
  DeleteExpensePrice,
  ListExpenses,
  UpdateExpense,
} from './application/expenses.js';
import {
  RunBudgetCheck,
  SendBudgetAlert,
  type BudgetAlertDeps,
} from './application/budget-alerts.js';
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

export {
  createBudgetAlertWorker,
  createFinanceWorker,
  FINANCE_EVENTS_QUEUE,
  FINANCE_QUEUE,
  financeSubscriptions,
  registerFinanceWorkers,
} from './infrastructure/budget-worker.js';
export type { FinanceWorkerDeps } from './infrastructure/budget-worker.js';

const NO_ALERTS: BudgetAlertDeps = {
  email: { send: () => Promise.reject(new Error('budget alerts are not wired')) },
  appUrl: 'http://localhost',
  logger: { info: () => undefined, warn: () => undefined },
};

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
  /** Sends the budget alert emails (FR-12); the SMTP sender from Platform settings. */
  email: EmailSender;
  /** APP_URL, for the alert's link. */
  appUrl: string;
  logger: AlertLogger;
  /** ENABLE_TEST_HOOKS and not production: registers POST /api/test/jobs/budget-check. */
  testHooks?: boolean;
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
  /** The daily budget check (FR-12), run by the worker and the test hook. */
  budgetCheck: RunBudgetCheck;
  /** The budget alert email, on `BudgetAlertRecorded` (FR-12), run by the events worker. */
  sendBudgetAlert: SendBudgetAlert;
  /** finance's tables (the budget alert job records alerts and snapshots through it). */
  store: FinanceStore;
}

/** Builds the module on any store (MySQL in production, in memory in tests). */
export function assembleFinance(
  ctx: FinanceContext,
  alerts?: BudgetAlertDeps & { testHooks?: boolean },
): Finance {
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
  const budget = new BudgetService(ctx);
  const budgetCheck = new RunBudgetCheck(ctx, budget);
  const sendBudgetAlert = new SendBudgetAlert(ctx, budget, alerts ?? NO_ALERTS);
  return {
    useCases,
    budget,
    budgetCheck,
    sendBudgetAlert,
    store: ctx.store,
    module: {
      name: 'finance',
      register: (app) =>
        financeRoutes(app, useCases, alerts?.testHooks ? { budgetCheck } : undefined),
    },
  };
}

/**
 * finance: Expenses, Provider invoices, the P&L and the Budget (prd-expenses, ADR 0020). Staff
 * only. Charges, metered costs and the P&L are computed on read; nothing depends on finance.
 */
export function createFinance(deps: FinanceDeps): Finance {
  const { db, audit, email, appUrl, logger, testHooks, ...rest } = deps;
  return assembleFinance(
    {
      ...rest,
      store: new KyselyFinanceStore(db, audit, new KyselyOutbox(rest.ids, rest.clock)),
    },
    { email, appUrl, logger, testHooks: testHooks ?? false },
  );
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
