import { Navigate } from 'react-router';
import { ErrorState, Skeleton } from '../../../shared/ui';
import { usePlanChoices } from '../api/hooks';
import { NoPlans } from '../components/empty-states';
import { copy } from '../copy';

/** The Leads rail item: the most recent Plan's Lead list (its switcher lists the others). */
export function LeadsIndexPage() {
  const plans = usePlanChoices();
  if (plans.isPending) {
    return (
      <div className="flex flex-col gap-3 p-6" role="status" aria-label={copy.loadingLeads}>
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (plans.isError) {
    return <ErrorState description={copy.loadFailed} onRetry={() => void plans.refetch()} />;
  }
  const newest = [...plans.data.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!newest) return <NoPlans />;
  return <Navigate to={`/plans/${newest.id}/leads`} replace />;
}
