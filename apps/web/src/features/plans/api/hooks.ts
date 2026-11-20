import { getProfile } from '@app/contracts/profile';
import { createPlan, getPlan, listPlans, searchPlaces, updatePlan } from '@app/contracts/planning';
import type { Plan, UpdatePlanBody } from '@app/contracts/planning';
import { startRun } from '@app/contracts/research';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';
import { creditsQueryKey } from '../../../shared/api/me';

export const plansKey = ['plans'] as const;
export const planKey = (id: string) => ['plans', id] as const;
/** One cache entry for the Business Profile, shared with the assistant and profile features. */
export const profileKey = ['profile'] as const;

export function usePlans() {
  return useInfiniteQuery({
    queryKey: [...plansKey, 'list'],
    retry: false,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ limit: '25' });
      if (pageParam) query.set('cursor', pageParam);
      return api(`/plans?${query.toString()}`, { schema: listPlans.response });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function usePlan(id: string) {
  return useQuery({
    queryKey: planKey(id),
    queryFn: () => api(`/plans/${id}`, { schema: getPlan.response }),
    retry: false,
  });
}

export function useProducts() {
  return useQuery({
    queryKey: profileKey,
    queryFn: () => api('/profile', { schema: getProfile.response }),
    retry: false,
  });
}

export function useCreatePlan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (goal: string) =>
      api('/plans', { method: 'POST', body: { goal }, schema: createPlan.response }),
    onSuccess: (plan) => {
      client.setQueryData<Plan>(planKey(plan.id), plan);
      void client.invalidateQueries({ queryKey: [...plansKey, 'list'] });
    },
  });
}

export function useUpdatePlan(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdatePlanBody) =>
      api(`/plans/${id}`, { method: 'PATCH', body, schema: updatePlan.response }),
    onSuccess: (plan) => {
      client.setQueryData<Plan>(planKey(id), plan);
      void client.invalidateQueries({ queryKey: [...plansKey, 'list'] });
    },
  });
}

export function useSearchPlaces() {
  return useMutation({
    mutationFn: (q: string) =>
      api(`/places/search?${new URLSearchParams({ q }).toString()}`, {
        schema: searchPlaces.response,
      }),
  });
}

/** FR-18 (client side): POST /api/plans/:id/runs. The reservation changes the balance and the Plan. */
export function useStartRun(planId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/plans/${planId}/runs`, { method: 'POST', schema: startRun.response }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: creditsQueryKey });
      void client.invalidateQueries({ queryKey: planKey(planId) });
    },
  });
}
