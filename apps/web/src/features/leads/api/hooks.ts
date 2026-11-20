import { getLead, listLeads, setLeadFeedback, type FeedbackValue } from '@app/contracts/leads';
import { getPlan, listPlans } from '@app/contracts/planning';
import { listPlanRuns } from '@app/contracts/research';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type { z } from 'zod';
import { api } from '../../../shared/api/client';
import { filtersToQuery, type LeadFilters } from '../lib/filters';

type ListResponse = z.infer<typeof listLeads.response>;

const listKey = (planId: string) => ['leads', 'list', planId] as const;
export const leadKey = (id: string) => ['leads', 'detail', id] as const;

/** One page is 50 Leads; "Load more" fetches the next cursor. */
export function useLeadList(planId: string, filters: LeadFilters) {
  return useInfiniteQuery({
    queryKey: [...listKey(planId), filters],
    retry: false,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const query = filtersToQuery(filters);
      query.set('limit', '50');
      if (pageParam) query.set('cursor', pageParam);
      return api(`/plans/${planId}/leads?${query.toString()}`, { schema: listLeads.response });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useLead(id: string | null) {
  return useQuery({
    queryKey: leadKey(id ?? ''),
    queryFn: () => api(`/leads/${id}`, { schema: getLead.response }),
    enabled: id !== null,
    retry: false,
  });
}

/** Newest first, as the API lists them: the plan switcher and the Leads rail item. */
export function usePlanChoices() {
  return useQuery({
    queryKey: ['leads', 'plans'],
    queryFn: () => api('/plans?limit=100', { schema: listPlans.response }),
    retry: false,
  });
}

export function usePlan(id: string | undefined) {
  return useQuery({
    queryKey: ['leads', 'plan', id],
    queryFn: () => api(`/plans/${id}`, { schema: getPlan.response }),
    enabled: id !== undefined,
    retry: false,
  });
}

export function usePlanRuns(planId: string) {
  return useQuery({
    queryKey: ['leads', 'runs', planId],
    queryFn: () => api(`/plans/${planId}/runs?limit=25`, { schema: listPlanRuns.response }),
    retry: false,
  });
}

export interface FeedbackInput {
  value: FeedbackValue | null;
  reason?: string;
}

/** FR-27: set, change or clear (value null). The list rows follow without a refetch. */
export function useSetFeedback(leadId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: FeedbackInput) =>
      api(`/leads/${leadId}/feedback`, {
        method: 'PUT',
        body: input,
        schema: setLeadFeedback.response,
      }),
    onSuccess: (lead) => {
      client.setQueryData(leadKey(leadId), lead);
      client.setQueriesData<InfiniteData<ListResponse>>(
        { queryKey: listKey(lead.planId) },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              items: p.items.map((i) => (i.id === lead.id ? { ...i, feedback: lead.feedback } : i)),
            })),
          },
      );
    },
  });
}
