import { listAuditLog } from '@app/contracts/platform';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../../../../shared/api/client';

export interface AuditFilters {
  businessId: string;
  staffMemberId: string;
  action: string;
}

export const noFilters: AuditFilters = { businessId: '', staffMemberId: '', action: '' };

function path(filters: AuditFilters, cursor: string | null): string {
  const query = new URLSearchParams({ limit: '50' });
  if (filters.businessId) query.set('businessId', filters.businessId);
  if (filters.staffMemberId) query.set('staffMemberId', filters.staffMemberId);
  if (filters.action) query.set('action', filters.action);
  if (cursor) query.set('cursor', cursor);
  return `/staff/audit-log?${query.toString()}`;
}

/** FR-7: entries newest first, filtered on the server, 50 per page behind a cursor. */
export function useAuditLog(filters: AuditFilters) {
  return useInfiniteQuery({
    queryKey: ['staff', 'audit-log', filters],
    retry: false,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api(path(filters, pageParam), { schema: listAuditLog.response }),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** The unfiltered first page, the source of the Business, Staff and Action choices. */
export function useAuditChoices() {
  return useQuery({
    queryKey: ['staff', 'audit-log', 'choices'],
    retry: false,
    queryFn: () => api(path(noFilters, null), { schema: listAuditLog.response }),
  });
}
