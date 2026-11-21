import { startActingAs } from '@app/contracts/identity';
import {
  getStaffTicket,
  getWaitingCount,
  listStaffTickets,
  listSupportStaff,
  staffTicketDetail,
  type AssigneeFilter,
  type Category,
  type ReplyThen,
  type StaffTicketDetail,
  type Status,
  type StaffView,
} from '@app/contracts/support';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../../../../shared/api/client';
import { meQueryKey } from '../../../../shared/api/me';

export const supportKeys = {
  tickets: ['staff', 'support', 'tickets'] as const,
  ticket: (number: number) => ['staff', 'support', 'ticket', number] as const,
  count: ['staff', 'support', 'count'] as const,
  staff: ['staff', 'support', 'staff'] as const,
};

export interface DeskFilters {
  view: StaffView;
  category: Category | undefined;
  assignee: AssigneeFilter | undefined;
}

function listPath(filters: DeskFilters, cursor: string | null): string {
  const query = new URLSearchParams({ view: filters.view });
  if (filters.category) query.set('category', filters.category);
  if (filters.assignee) query.set('assignee', filters.assignee);
  if (cursor) query.set('cursor', cursor);
  return `/staff/support/tickets?${query.toString()}`;
}

/** FR-6: the desk list, a view at a time, with cursor paging. */
export function useStaffTickets(filters: DeskFilters) {
  return useInfiniteQuery({
    queryKey: [...supportKeys.tickets, filters],
    retry: false,
    placeholderData: keepPreviousData,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api(listPath(filters, pageParam), { schema: listStaffTickets.response }),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** FR-8: the assignee picker. */
export function useSupportStaff() {
  return useQuery({
    queryKey: supportKeys.staff,
    retry: false,
    queryFn: () => api('/staff/support/staff', { schema: listSupportStaff.response }),
  });
}

/** FR-7: one ticket with its whole thread. */
export function useStaffTicket(number: number) {
  return useQuery({
    queryKey: supportKeys.ticket(number),
    retry: false,
    queryFn: () => api(`/staff/support/tickets/${number}`, { schema: getStaffTicket.response }),
  });
}

/**
 * FR-6: the nav badge. Refetches every 60 s and when the window regains focus; pass
 * `enabled: false` for anyone who is not Staff.
 */
export function useSupportWaitingCount(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: supportKeys.count,
    retry: false,
    enabled: options.enabled ?? true,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: () => api('/staff/support/count', { schema: getWaitingCount.response }),
    select: (r) => r.waiting,
  });
}

export function isVersionConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === 'VERSION_CONFLICT';
}

function conflictTicket(error: unknown): StaffTicketDetail | null {
  if (!isVersionConflict(error)) return null;
  const parsed = staffTicketDetail.safeParse((error as ApiError).details?.ticket);
  return parsed.success ? parsed.data : null;
}

interface Actions {
  take: ReturnType<typeof useActionMutation<void>>;
  assign: ReturnType<typeof useActionMutation<string | null>>;
  setStatus: ReturnType<typeof useActionMutation<Status>>;
  reply: ReturnType<typeof useActionMutation<{ message: string; then?: ReplyThen }>>;
  note: ReturnType<typeof useActionMutation<string>>;
  error: unknown;
  clearError: () => void;
}

/** Keeps the returned ticket (or, on a version conflict, the latest one) in the cache. */
function useActionMutation<V>(
  number: number,
  call: (variables: V) => Promise<StaffTicketDetail>,
  onResult: (error: unknown) => void,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: call,
    onSuccess: (ticket) => {
      onResult(null);
      client.setQueryData(supportKeys.ticket(number), ticket);
      void client.invalidateQueries({ queryKey: supportKeys.tickets });
      void client.invalidateQueries({ queryKey: supportKeys.count });
    },
    onError: (error) => {
      onResult(error);
      const latest = conflictTicket(error);
      if (latest) client.setQueryData(supportKeys.ticket(number), latest);
    },
  });
}

/** FR-8, FR-9, FR-10: every change to one ticket, with the last error kept for the page. */
export function useTicketActions(ticket: StaffTicketDetail): Actions {
  const [error, setError] = useState<unknown>(null);
  const base = `/staff/support/tickets/${ticket.number}`;
  const { version, number } = ticket;
  const post = (path: string, body: unknown) =>
    api(`${base}/${path}`, { method: 'POST', body, schema: staffTicketDetail });
  const take = useActionMutation<void>(number, () => post('take', { version }), setError);
  const assign = useActionMutation<string | null>(
    number,
    (assigneeId) => post('assign', { version, assigneeId }),
    setError,
  );
  const setStatus = useActionMutation<Status>(
    number,
    (status) => post('status', { version, status }),
    setError,
  );
  const reply = useActionMutation<{ message: string; then?: ReplyThen }>(
    number,
    (body) => post('replies', body),
    setError,
  );
  const note = useActionMutation<string>(number, (text) => post('notes', { note: text }), setError);
  return { take, assign, setStatus, reply, note, error, clearError: () => setError(null) };
}

/** FR-6: start Acting as the ticket's Business (the Audit log records the ticket), then open the customer app. */
export function useOpenAsBusiness() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (v: { businessId: string; ticketNumber: number }) =>
      api('/staff/acting-as', { method: 'POST', body: v, schema: startActingAs.response }),
    onSuccess: (me) => {
      client.setQueryData(meQueryKey, me);
      void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== meQueryKey[0] });
      void navigate('/plans');
    },
  });
}
