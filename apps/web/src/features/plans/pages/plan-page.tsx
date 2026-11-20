import { useLocation, useParams } from 'react-router';
import { ApiError } from '../../../shared/api/client';
import { Banner, ErrorState, Skeleton } from '../../../shared/ui';
import { usePlan, useProducts } from '../api/hooks';
import { PlanEditor } from '../components/plan-editor';
import { copy, fill } from '../copy';

/** FR-17: the Plan editor at /app/plans/:id. */
export function PlanPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const plan = usePlan(id);
  const profile = useProducts();
  const stateWarnings = (location.state as { warnings?: string[] } | null)?.warnings;
  const warnings = [...new Set([...(stateWarnings ?? []), ...(plan.data?.warnings ?? [])])];

  const loading = plan.isPending || profile.isPending;
  const notFound = plan.error instanceof ApiError && plan.error.status === 404;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-7">
      {loading && (
        <div className="flex flex-col gap-4" role="status" aria-label="Loading plan">
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      )}
      {notFound && <ErrorState title={copy.planNotFound} description={copy.planNotFoundBody} />}
      {!notFound && (plan.isError || profile.isError) && (
        <ErrorState
          description={copy.planLoadFailed}
          onRetry={() => {
            void plan.refetch();
            void profile.refetch();
          }}
        />
      )}
      {plan.isSuccess && profile.isSuccess && (
        <>
          <header className="flex flex-col gap-1">
            <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">
              {plan.data.name}
            </h1>
            <p className="m-0 text-sm text-muted">{fill(copy.goal, { goal: plan.data.goal })}</p>
          </header>
          {warnings.map((w) => (
            <Banner key={w} tone="warn">
              {w}
            </Banner>
          ))}
          <PlanEditor key={plan.data.id} plan={plan.data} products={profile.data.products} />
        </>
      )}
    </div>
  );
}
