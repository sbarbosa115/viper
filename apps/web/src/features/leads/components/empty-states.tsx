import type { PlanSummary } from '@app/contracts/planning';
import { Link } from 'react-router';
import { Button, EmptyState } from '../../../shared/ui';
import { copy } from '../copy';

const linkButton =
  'inline-flex h-10 items-center justify-center whitespace-nowrap rounded-control bg-accent px-4 text-sm font-semibold text-accent-ink hover:bg-accent-hover';

export function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <EmptyState
      title={copy.noMatchTitle}
      action={<Button onClick={onClear}>{copy.clear}</Button>}
    />
  );
}

/** No Leads and no filters: start research, or follow the run that is going. */
export function NoLeads({
  planId,
  lastRun,
}: {
  planId: string;
  lastRun: PlanSummary['lastRun'] | undefined;
}) {
  const active = lastRun && ['queued', 'running', 'retrying'].includes(lastRun.status);
  if (active) {
    return (
      <EmptyState
        title={copy.inProgressTitle}
        description={copy.inProgressBody}
        action={
          <Link to={`/runs/${lastRun.id}`} className={linkButton}>
            {copy.viewProgress}
          </Link>
        }
      />
    );
  }
  return (
    <EmptyState
      title={copy.noLeadsTitle}
      description={copy.noLeadsBody}
      action={
        <Link to={`/plans/${planId}`} className={linkButton}>
          {copy.goToPlan}
        </Link>
      }
    />
  );
}

/** The Leads rail item with no Plans: the Plans empty state. */
export function NoPlans() {
  return (
    <EmptyState
      headingLevel={1}
      title={copy.plansEmptyTitle}
      description={copy.plansEmptyBody}
      action={
        <Link to="/plans/new" className={linkButton}>
          {copy.newPlan}
        </Link>
      }
    />
  );
}
