import { grantCredits } from '@app/contracts/billing';
import { startActingAs } from '@app/contracts/identity';
import { listCustomers, updateCustomer } from '@app/contracts/reporting';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../../../../shared/api/client';
import { meQueryKey } from '../../../../shared/api/me';

export type CustomerSort = 'signedUp' | 'lastActive';

export interface CustomerFilters {
  q: string;
  sort: CustomerSort;
}

export const customersKey = ['staff', 'customers'] as const;

function path(filters: CustomerFilters, cursor: string | null): string {
  const query = new URLSearchParams({ limit: '50', sort: filters.sort });
  if (filters.q) query.set('q', filters.q);
  if (cursor) query.set('cursor', cursor);
  return `/staff/businesses?${query.toString()}`;
}

/** FR-31: search, sort and cursor paging (50 per page) on the server. */
export function useCustomers(filters: CustomerFilters) {
  return useInfiniteQuery({
    queryKey: [...customersKey, filters],
    retry: false,
    placeholderData: keepPreviousData,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api(path(filters, pageParam), { schema: listCustomers.response }),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** FR-6: Act as a Business, then show their Plans exactly as the Owner sees them. */
export function useActAs() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (businessId: string) =>
      api('/staff/acting-as', {
        method: 'POST',
        body: { businessId },
        schema: startActingAs.response,
      }),
    onSuccess: (me) => {
      client.setQueryData(meQueryKey, me);
      void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== meQueryKey[0] });
      void navigate('/plans');
    },
  });
}

/** FR-31: mark or unmark a Business internal. */
export function useSetInternal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, internal }: { id: string; internal: boolean }) =>
      api(`/staff/businesses/${id}`, {
        method: 'PATCH',
        body: { internal },
        schema: updateCustomer.response,
      }),
    onSettled: () => client.invalidateQueries({ queryKey: customersKey }),
  });
}

/** FR-13: add or remove credits with a reason. */
export function useGrantCredits() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, credits, reason }: { id: string; credits: number; reason: string }) =>
      api(`/staff/businesses/${id}/credits`, {
        method: 'POST',
        body: { credits, reason },
        schema: grantCredits.response,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: customersKey }),
  });
}
