import { listTools, updateTool, type UpdateToolBody } from '@app/contracts/tools';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../shared/api/client';

export const toolsKey = ['staff', 'tools'] as const;

/** FR-23: every Tool with its Rate card price and 24 h health. */
export function useTools() {
  return useQuery({
    queryKey: toolsKey,
    queryFn: () => api('/staff/tools', { schema: listTools.response }),
    retry: false,
  });
}

/** Saves one Tool's changes (PATCH), then re-reads the list. */
export function useUpdateTool() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ key, body }: { key: string; body: UpdateToolBody }) =>
      api(`/staff/tools/${key}`, { method: 'PATCH', body, schema: updateTool.response }),
    onSettled: () => client.invalidateQueries({ queryKey: toolsKey }),
  });
}
