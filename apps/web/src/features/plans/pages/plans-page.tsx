import type { PlanSummary } from '@app/contracts/planning';
import { Link } from 'react-router';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusPill,
  Table,
  type Column,
  type StatusKind,
} from '../../../shared/ui';
import { usePlans } from '../api/hooks';
import { LinkButton } from '../components/link-button';
import { copy, fill } from '../copy';
import { formatShortDate, isActiveRun } from '../lib/runs';

function statusKind(plan: PlanSummary): StatusKind {
  switch (plan.lastRun?.status) {
    case undefined:
      return 'new';
    case 'queued':
    case 'running':
      return 'running';
    case 'retrying':
      return 'retrying';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'completed':
      return 'ok';
  }
}

const linkClass = 'text-accent hover:underline';

const columns: Column<PlanSummary>[] = [
  {
    key: 'plan',
    header: copy.colPlan,
    cell: (p) => (
      <span className="flex flex-col">
        <Link to={`/plans/${p.id}`} className="font-semibold text-fg hover:underline">
          {p.name}
        </Link>
        <span className="text-[13px] text-muted">{p.goal}</span>
      </span>
    ),
  },
  {
    key: 'radius',
    header: copy.colRadius,
    numeric: true,
    cell: (p) => fill(copy.miles, { n: p.searchArea.radiusMiles }),
  },
  {
    key: 'lastRun',
    header: copy.colLastRun,
    cell: (p) => {
      const at = p.lastRun?.startedAt ?? p.lastRun?.finishedAt;
      return at ? formatShortDate(at) : '—';
    },
  },
  {
    key: 'leads',
    header: copy.colLeads,
    numeric: true,
    cell: (p) => (p.lastRun ? p.leadsCount : '—'),
  },
  {
    key: 'credits',
    header: copy.colCredits,
    numeric: true,
    cell: (p) => p.lastRun?.creditsSpent ?? '—',
  },
  {
    key: 'status',
    header: copy.colStatus,
    cell: (p) => (
      <span className="flex flex-col gap-1">
        <StatusPill kind={statusKind(p)} />
        {isActiveRun(p.lastRun) ? (
          <Link
            to={`/runs/${p.lastRun.id}`}
            aria-label={fill(copy.progressFor, { name: p.name })}
            className={linkClass}
          >
            {copy.viewProgress}
          </Link>
        ) : (
          p.leadsCount > 0 && (
            <Link
              to={`/plans/${p.id}/leads`}
              aria-label={fill(copy.viewLeadsFor, { name: p.name })}
              className={linkClass}
            >
              {fill(copy.viewLeads, { n: p.leadsCount })}
            </Link>
          )
        )}
      </span>
    ),
  },
];

/** The Plans list (PRD 6b). */
export function PlansPage() {
  const plans = usePlans();
  const items = plans.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">
            {copy.plansTitle}
          </h1>
          <p className="m-0 mt-1 text-sm text-muted">{copy.plansIntro}</p>
        </div>
        {items.length > 0 && (
          <LinkButton variant="primary" to="/plans/new">
            {copy.newPlan}
          </LinkButton>
        )}
      </div>
      {plans.isPending && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading plans">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      )}
      {plans.isError && (
        <ErrorState description={copy.loadFailed} onRetry={() => void plans.refetch()} />
      )}
      {plans.isSuccess &&
        (items.length === 0 ? (
          <Card>
            <EmptyState
              title={copy.emptyTitle}
              description={copy.emptyBody}
              action={
                <LinkButton variant="primary" to="/plans/new">
                  {copy.newPlan}
                </LinkButton>
              }
            />
          </Card>
        ) : (
          <>
            <Table
              caption={copy.plansCaption}
              columns={columns}
              rows={items}
              rowKey={(p) => p.id}
            />
            {plans.hasNextPage && (
              <Button
                className="self-center"
                loading={plans.isFetchingNextPage}
                onClick={() => void plans.fetchNextPage()}
              >
                {copy.showMore}
              </Button>
            )}
          </>
        ))}
    </div>
  );
}
