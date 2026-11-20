import {
  createCreditPack,
  listCreditPacks,
  updateCreditPack,
  type CreditPackInput,
} from '@app/contracts/billing';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../shared/api/client';
import { creditsQueryKey } from '../../../../shared/api/me';

export const packsQueryKey = ['staff', 'credit-packs'] as const;

/** FR-13: every pack, active or not, in display order. */
export function usePacks() {
  return useQuery({
    queryKey: packsQueryKey,
    queryFn: () => api('/staff/credit-packs', { schema: listCreditPacks.response }),
    retry: false,
  });
}

/** Create (no id) or update (id) a pack; both lists that show packs refresh. */
export function useSavePack() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: CreditPackInput }) =>
      id === null
        ? api('/staff/credit-packs', {
            method: 'POST',
            body: input,
            schema: createCreditPack.response,
          })
        : api(`/staff/credit-packs/${id}`, {
            method: 'PUT',
            body: input,
            schema: updateCreditPack.response,
          }),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: packsQueryKey }),
        client.invalidateQueries({ queryKey: creditsQueryKey }),
      ]),
  });
}
