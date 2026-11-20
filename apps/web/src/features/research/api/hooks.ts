import { getPlan } from '@app/contracts/planning';
import { cancelRun, getRun, resumeRun, type RunSummary } from '@app/contracts/research';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';
import { creditsQueryKey } from '../../../shared/api/me';

export const runKey = (id: string) => ['research', 'run', id] as const;

export const POLL_MS = 10_000;

export const isActive = (run: Pick<RunSummary, 'status'> | undefined): boolean =>
  run !== undefined && ['queued', 'running', 'retrying'].includes(run.status);

/** The run, re-read every 10 s while it is queued, running or retrying (FR-21). */
export function useRun(id: string) {
  return useQuery({
    queryKey: runKey(id),
    queryFn: () => api(`/runs/${id}`, { schema: getRun.response }),
    retry: false,
    refetchInterval: (query) => (isActive(query.state.data) ? POLL_MS : false),
  });
}

export function usePlanName(planId: string | undefined) {
  return useQuery({
    queryKey: ['research', 'plan', planId],
    queryFn: () => api(`/plans/${planId}`, { schema: getPlan.response }),
    enabled: planId !== undefined,
    retry: false,
    select: (plan) => plan.name,
  });
}

/** Credits and Plans change when a run ends or restarts; refresh what other screens show. */
export function useRefreshAfterRun() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: creditsQueryKey });
    void client.invalidateQueries({ queryKey: ['plans'] });
  };
}

export function useCancelRun(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/runs/${id}/cancel`, { method: 'POST', schema: cancelRun.response }),
    onSuccess: (run) => client.setQueryData(runKey(id), run),
    onError: () => void client.invalidateQueries({ queryKey: runKey(id) }),
  });
}

export function useResumeRun(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/runs/${id}/resume`, { method: 'POST', schema: resumeRun.response }),
    onSuccess: (run) => {
      client.setQueryData(runKey(id), run);
      void client.invalidateQueries({ queryKey: creditsQueryKey });
    },
  });
}
