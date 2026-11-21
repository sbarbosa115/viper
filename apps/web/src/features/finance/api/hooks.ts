import {
  addExpensePrice,
  createExpense,
  deleteExpensePrice,
  deleteProviderInvoice,
  getPnl,
  listExpenses,
  listProviderInvoices,
  listProviders,
  saveBudget,
  saveProviderInvoice,
  updateExpense,
  type AddPriceBody,
  type Category,
  type CreateExpenseBody,
  type Month,
  type SaveInvoiceBody,
  type UpdateExpenseBody,
} from '@app/contracts/finance';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';

const root = ['staff', 'finance'] as const;
const base = '/staff/finance';

/** FR-9, FR-11: the P&L for a month. */
export function usePnl(month: Month) {
  return useQuery({
    queryKey: [...root, 'pnl', month],
    queryFn: () => api(`${base}/pnl?month=${month}`, { schema: getPnl.response }),
    retry: false,
  });
}

export interface ExpenseFilters {
  category: Category | null;
  includeEnded: boolean;
}

/** FR-1: bills and one-offs; the kind filter is applied by the page so the chips can count. */
export function useExpenses(month: Month, filters: ExpenseFilters) {
  return useQuery({
    queryKey: [...root, 'expenses', month, filters.category, filters.includeEnded],
    queryFn: () => {
      const query = new URLSearchParams({ month });
      if (filters.category) query.set('category', filters.category);
      if (filters.includeEnded) query.set('includeEnded', 'true');
      return api(`${base}/expenses?${query.toString()}`, { schema: listExpenses.response });
    },
    retry: false,
  });
}

/** FR-6: the Tool catalog's providers for the "covers usage of" picker. */
export function useProviders(enabled = true) {
  return useQuery({
    queryKey: [...root, 'providers'],
    queryFn: () => api(`${base}/providers`, { schema: listProviders.response }),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** FR-8: providers with metered cost, a plan or an invoice. */
export function useProviderInvoices(month: Month) {
  return useQuery({
    queryKey: [...root, 'invoices', month],
    queryFn: () =>
      api(`${base}/provider-invoices?month=${month}`, { schema: listProviderInvoices.response }),
    retry: false,
  });
}

/** Every finance number can change after any write, so all finance queries refresh. */
function useRefreshFinance() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: root });
}

export function useCreateExpense() {
  const refresh = useRefreshFinance();
  return useMutation({
    mutationFn: (body: CreateExpenseBody) =>
      api(`${base}/expenses`, { method: 'POST', body, schema: createExpense.response }),
    onSuccess: refresh,
  });
}

export function useUpdateExpense() {
  const refresh = useRefreshFinance();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateExpenseBody }) =>
      api(`${base}/expenses/${id}`, { method: 'PATCH', body, schema: updateExpense.response }),
    onSuccess: refresh,
  });
}

export function useAddPrice() {
  const refresh = useRefreshFinance();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AddPriceBody }) =>
      api(`${base}/expenses/${id}/prices`, {
        method: 'POST',
        body,
        schema: addExpensePrice.response,
      }),
    onSuccess: refresh,
  });
}

export function useDeletePrice() {
  const refresh = useRefreshFinance();
  return useMutation({
    mutationFn: ({ id, effectiveFrom }: { id: string; effectiveFrom: string }) =>
      api(`${base}/expenses/${id}/prices/${effectiveFrom}`, {
        method: 'DELETE',
        schema: deleteExpensePrice.response,
      }),
    onSuccess: refresh,
  });
}

export function useDeleteExpense() {
  const refresh = useRefreshFinance();
  return useMutation({
    mutationFn: (id: string) => api(`${base}/expenses/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
}

export function useSaveInvoice(month: Month) {
  const refresh = useRefreshFinance();
  return useMutation({
    mutationFn: ({ provider, body }: { provider: string; body: SaveInvoiceBody }) =>
      api(`${base}/provider-invoices/${provider}/${month}`, {
        method: 'PUT',
        body,
        schema: saveProviderInvoice.response,
      }),
    onSuccess: refresh,
  });
}

export function useDeleteInvoice(month: Month) {
  const refresh = useRefreshFinance();
  return useMutation({
    mutationFn: (provider: string) =>
      api(`${base}/provider-invoices/${provider}/${month}`, {
        method: 'DELETE',
        schema: deleteProviderInvoice.response,
      }),
    onSuccess: refresh,
  });
}

export function useSaveBudget() {
  const refresh = useRefreshFinance();
  return useMutation({
    mutationFn: (monthlyBudgetCents: number) =>
      api(`${base}/budget`, {
        method: 'PUT',
        body: { monthlyBudgetCents },
        schema: saveBudget.response,
      }),
    onSuccess: refresh,
  });
}
