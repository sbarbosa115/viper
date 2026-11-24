import {
  closeTicket,
  createTicket,
  getTicket,
  listSupportRuns,
  listTickets,
  replyToTicket,
  type CreateTicketBody,
  type TicketDetail,
  type TicketListFilter,
} from '@app/contracts/support';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../shared/api/client';

const root = ['support'] as const;
const base = '/support';

/** FR-1: Your tickets, 25 per page ("Show more"). */
export function useTickets(status: TicketListFilter) {
  return useInfiniteQuery({
    queryKey: [...root, 'tickets', status],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ status });
      if (pageParam) query.set('cursor', pageParam);
      return api(`${base}/tickets?${query.toString()}`, { schema: listTickets.response });
    },
    getNextPageParam: (last) => last.nextCursor,
    retry: false,
  });
}

/** FR-4: one ticket with its thread. */
export function useTicket(number: number) {
  return useQuery({
    queryKey: [...root, 'ticket', number],
    queryFn: () => api(`${base}/tickets/${number}`, { schema: getTicket.response }),
    retry: false,
  });
}

/** FR-2: the run picker (last 90 days, newest first). */
export function useSupportRuns() {
  return useQuery({
    queryKey: [...root, 'runs'],
    queryFn: () => api(`${base}/runs`, { schema: listSupportRuns.response }),
    retry: false,
    staleTime: 60_000,
  });
}

/** A write returns the whole ticket: put it in the cache and refresh the lists and counts. */
function useAfterWrite() {
  const client = useQueryClient();
  return (ticket: TicketDetail) => {
    client.setQueryData([...root, 'ticket', ticket.number], ticket);
    return client.invalidateQueries({ queryKey: [...root, 'tickets'] });
  };
}

export function useCreateTicket() {
  const after = useAfterWrite();
  return useMutation({
    mutationFn: (body: CreateTicketBody) =>
      api(`${base}/tickets`, { method: 'POST', body, schema: createTicket.response }),
    onSuccess: after,
  });
}

export function useReply(number: number) {
  const after = useAfterWrite();
  return useMutation({
    mutationFn: (message: string) =>
      api(`${base}/tickets/${number}/replies`, {
        method: 'POST',
        body: { message },
        schema: replyToTicket.response,
      }),
    onSuccess: after,
  });
}

export function useCloseTicket(number: number) {
  const after = useAfterWrite();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api(`${base}/tickets/${number}/close`, {
        method: 'POST',
        body: {},
        schema: closeTicket.response,
      }),
    onSuccess: after,
    // ALREADY_CLOSED: the thread is stale, so refresh it (FR-5).
    onError: () => client.invalidateQueries({ queryKey: [...root, 'ticket', number] }),
  });
}
