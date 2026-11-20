import {
  getFlow,
  getQueueHealth,
  getStaffRun,
  listStaffRuns,
  resumeStaffRun,
  type RunStatus,
} from '@app/contracts/research';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '../../../../shared/api/client';

export interface RunFilters {
  status: RunStatus | '';
  businessId: string;
}

export const noRunFilters: RunFilters = { status: '', businessId: '' };

const REFRESH_MS = 15_000;

function path(filters: RunFilters, cursor: string | null): string {
  const query = new URLSearchParams({ limit: '25' });
  if (filters.status) query.set('status', filters.status);
  if (filters.businessId) query.set('businessId', filters.businessId);
  if (cursor) query.set('cursor', cursor);
  return `/staff/runs?${query.toString()}`;
}

/** FR-32: runs newest first, filtered on the server, 25 per page behind a cursor. */
export function useStaffRuns(filters: RunFilters) {
  return useInfiniteQuery({
    queryKey: ['staff', 'runs', 'list', filters],
    retry: false,
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api(path(filters, pageParam), { schema: listStaffRuns.response }),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** The unfiltered first page: the source of the Business filter choices. */
export function useRunBusinesses() {
  return useQuery({
    queryKey: ['staff', 'runs', 'choices'],
    retry: false,
    queryFn: () => api(path(noRunFilters, null), { schema: listStaffRuns.response }),
  });
}

/** FR-32 queue health: waiting, active, retrying, failed, stalled, sweeper and worker heartbeat. */
export function useQueueHealth() {
  return useQuery({
    queryKey: ['staff', 'runs', 'queue'],
    retry: false,
    refetchInterval: REFRESH_MS,
    queryFn: () => api('/staff/queue', { schema: getQueueHealth.response }),
  });
}

export const runKey = (id: string) => ['staff', 'runs', 'detail', id] as const;

export function useStaffRun(id: string) {
  return useQuery({
    queryKey: runKey(id),
    retry: false,
    refetchInterval: REFRESH_MS,
    queryFn: () => api(`/staff/runs/${id}`, { schema: getStaffRun.response }),
  });
}

/** The latest version of the run's flow, for the limits line; absent is fine. */
export function useFlowLimits(key: string) {
  return useQuery({
    queryKey: ['staff', 'flows', 'detail', key],
    retry: false,
    queryFn: () => api(`/staff/flows/${key}`, { schema: getFlow.response }),
  });
}

/** FR-32: a new attempt from the last handoff; same run id. */
export function useResumeRun(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api(`/staff/runs/${id}/resume`, { method: 'POST', schema: resumeStaffRun.response }),
    onSettled: () => client.invalidateQueries({ queryKey: ['staff', 'runs'] }),
  });
}
