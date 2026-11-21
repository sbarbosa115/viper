import { routePath } from '@app/contracts/common';
import {
  addExpensePrice,
  createExpense,
  deleteExpense,
  deleteExpensePrice,
  deleteProviderInvoice,
  exportPnlCsv,
  getBudget,
  getPnl,
  listExpenses,
  listProviderInvoices,
  listProviders,
  saveBudget,
  saveProviderInvoice,
  updateExpense,
  financeTestContracts,
} from '@app/contracts/finance';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { RunBudgetCheck } from '../application/budget-alerts.js';
import type {
  AddExpensePrice,
  CreateExpense,
  DeleteExpense,
  DeleteExpensePrice,
  ListExpenses,
  UpdateExpense,
} from '../application/expenses.js';
import type { ExportPnlCsv, GetBudget, GetPnl, SaveBudget } from '../application/pnl.js';
import type {
  DeleteProviderInvoice,
  ListProviderInvoices,
  ListProviders,
  SaveProviderInvoice,
} from '../application/provider-invoices.js';

export interface FinanceUseCases {
  listExpenses: ListExpenses;
  createExpense: CreateExpense;
  updateExpense: UpdateExpense;
  addExpensePrice: AddExpensePrice;
  deleteExpensePrice: DeleteExpensePrice;
  deleteExpense: DeleteExpense;
  listProviders: ListProviders;
  listProviderInvoices: ListProviderInvoices;
  saveProviderInvoice: SaveProviderInvoice;
  deleteProviderInvoice: DeleteProviderInvoice;
  getPnl: GetPnl;
  exportPnlCsv: ExportPnlCsv;
  getBudget: GetBudget;
  saveBudget: SaveBudget;
}

/** prd-expenses section 7. Staff checks (403) live in the use cases. */
export function financeRoutes(
  app: FastifyInstance,
  uc: FinanceUseCases,
  testHooks?: { budgetCheck: RunBudgetCheck },
): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };
  const tags = ['finance'];

  api.get(
    routePath(listExpenses),
    {
      ...auth,
      schema: { tags, querystring: listExpenses.query, response: { 200: listExpenses.response } },
    },
    (req) => uc.listExpenses.execute(req.actor, req.query),
  );

  api.post(
    routePath(createExpense),
    {
      ...auth,
      schema: { tags, body: createExpense.body, response: { 201: createExpense.response } },
    },
    async (req, reply) =>
      reply.status(201).send(await uc.createExpense.execute(req.actor, req.body)),
  );

  api.patch(
    routePath(updateExpense),
    {
      ...auth,
      schema: {
        tags,
        params: updateExpense.params,
        body: updateExpense.body,
        response: { 200: updateExpense.response },
      },
    },
    (req) => uc.updateExpense.execute(req.actor, req.params.id, req.body),
  );

  api.post(
    routePath(addExpensePrice),
    {
      ...auth,
      schema: {
        tags,
        params: addExpensePrice.params,
        body: addExpensePrice.body,
        response: { 201: addExpensePrice.response },
      },
    },
    async (req, reply) =>
      reply.status(201).send(await uc.addExpensePrice.execute(req.actor, req.params.id, req.body)),
  );

  api.delete(
    routePath(deleteExpensePrice),
    {
      ...auth,
      schema: {
        tags,
        params: deleteExpensePrice.params,
        response: { 200: deleteExpensePrice.response },
      },
    },
    (req) => uc.deleteExpensePrice.execute(req.actor, req.params.id, req.params.effectiveFrom),
  );

  api.delete(
    routePath(deleteExpense),
    { ...auth, schema: { tags, params: deleteExpense.params } },
    async (req, reply) => {
      await uc.deleteExpense.execute(req.actor, req.params.id);
      return reply.status(204).send();
    },
  );

  api.get(
    routePath(listProviders),
    { ...auth, schema: { tags, response: { 200: listProviders.response } } },
    (req) => uc.listProviders.execute(req.actor),
  );

  api.get(
    routePath(listProviderInvoices),
    {
      ...auth,
      schema: {
        tags,
        querystring: listProviderInvoices.query,
        response: { 200: listProviderInvoices.response },
      },
    },
    (req) => uc.listProviderInvoices.execute(req.actor, req.query),
  );

  api.put(
    routePath(saveProviderInvoice),
    {
      ...auth,
      schema: {
        tags,
        params: saveProviderInvoice.params,
        body: saveProviderInvoice.body,
        response: { 200: saveProviderInvoice.response },
      },
    },
    (req) =>
      uc.saveProviderInvoice.execute(req.actor, req.params.provider, req.params.month, req.body),
  );

  api.delete(
    routePath(deleteProviderInvoice),
    {
      ...auth,
      schema: {
        tags,
        params: deleteProviderInvoice.params,
        response: { 200: deleteProviderInvoice.response },
      },
    },
    (req) => uc.deleteProviderInvoice.execute(req.actor, req.params.provider, req.params.month),
  );

  api.get(
    routePath(getPnl),
    { ...auth, schema: { tags, querystring: getPnl.query, response: { 200: getPnl.response } } },
    (req) => uc.getPnl.execute(req.actor, req.query),
  );

  api.get(
    routePath(exportPnlCsv),
    { ...auth, schema: { tags, querystring: exportPnlCsv.query } },
    async (req, reply) => {
      const { fileName, csv } = await uc.exportPnlCsv.execute(req.actor, req.query);
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${fileName}"`)
        .header('Cache-Control', 'no-store')
        .send(csv);
    },
  );

  api.get(
    routePath(getBudget),
    { ...auth, schema: { tags, response: { 200: getBudget.response } } },
    (req) => uc.getBudget.execute(req.actor),
  );

  api.put(
    routePath(saveBudget),
    { ...auth, schema: { tags, body: saveBudget.body, response: { 200: saveBudget.response } } },
    (req) => uc.saveBudget.execute(req.actor, req.body),
  );

  if (testHooks) {
    const { runBudgetCheck } = financeTestContracts;
    api.post(
      routePath(runBudgetCheck),
      {
        schema: {
          hide: true,
          // `reset` is e2e-only: forget this month's recorded alerts first (the seed records some).
          body: z.object({ reset: z.boolean().optional() }).nullish(),
          response: { 200: runBudgetCheck.response },
        },
      },
      async (req) => {
        if (req.body?.reset) await testHooks.budgetCheck.resetMonth();
        return { sent: await testHooks.budgetCheck.execute() };
      },
    );
  }
}
