import { getFlow, listFlows, updateFlow, type FlowInput } from '@app/contracts/research';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../shared/api/client';

export const flowsKey = ['staff', 'flows'] as const;

export function useFlows() {
  return useQuery({
    queryKey: [...flowsKey, 'list'],
    retry: false,
    queryFn: () => api('/staff/flows', { schema: listFlows.response }),
  });
}

export function useFlow(key: string | null) {
  return useQuery({
    queryKey: [...flowsKey, 'detail', key],
    enabled: key !== null,
    retry: false,
    queryFn: () => api(`/staff/flows/${key}`, { schema: getFlow.response }),
  });
}

/** FR-37: saving creates a new flow version; the list and the detail refresh. */
export function useSaveFlow(key: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: FlowInput) =>
      api(`/staff/flows/${key}`, { method: 'PUT', body: input, schema: updateFlow.response }),
    onSuccess: (flow) => {
      client.setQueryData([...flowsKey, 'detail', key], flow);
      return client.invalidateQueries({ queryKey: [...flowsKey, 'list'] });
    },
  });
}
