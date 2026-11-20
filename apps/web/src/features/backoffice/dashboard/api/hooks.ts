import { startActingAs } from '@app/contracts/identity';
import { getDashboard, type DashboardPeriod } from '@app/contracts/reporting';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../../../../shared/api/client';
import { meQueryKey } from '../../../../shared/api/me';

/** FR-30: every tile for the period and the one before it. */
export function useDashboard(period: DashboardPeriod) {
  return useQuery({
    queryKey: ['staff', 'dashboard', period],
    queryFn: () => api(`/staff/dashboard?period=${period}`, { schema: getDashboard.response }),
    retry: false,
  });
}

/** FR-6: Act as a Business, then show their Plans exactly as the Owner sees them. */
export function useActAs() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (businessId: string) =>
      api('/staff/acting-as', {
        method: 'POST',
        body: { businessId },
        schema: startActingAs.response,
      }),
    onSuccess: (me) => {
      client.setQueryData(meQueryKey, me);
      void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== meQueryKey[0] });
      void navigate('/plans');
    },
  });
}
