import { Link, useParams } from 'react-router';
import { ApiError } from '../../../shared/api/client';
import { ErrorState, ScoreBadge, Skeleton } from '../../../shared/ui';
import { useLead, usePlan } from '../api/hooks';
import { useFeedbackActions } from '../api/use-feedback';
import { ContactTable } from '../components/contacts';
import { EvidenceList } from '../components/evidence';
import { FeedbackControls } from '../components/feedback-controls';
import { PitchCard } from '../components/pitch-card';
import { copy, fill } from '../copy';
import { formatDate, formatMiles } from '../lib/format';
import { useShortcuts } from '../lib/use-shortcuts';

const sectionTitle = 'm-0 text-xs font-semibold uppercase tracking-[0.08em] text-muted';

/** FR-26: the full Lead detail at /app/leads/:id (the deep link). */
export function LeadDetailPage() {
  const { id = '' } = useParams();
  const lead = useLead(id);
  const plan = usePlan(lead.data?.planId);
  const actions = useFeedbackActions(lead.data);
  useShortcuts({ g: actions.good, n: actions.notFit });

  const notFound = lead.error instanceof ApiError && lead.error.status === 404;
  const planName = plan.data?.name ?? copy.plan;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-7">
      {lead.isPending && (
        <div className="flex flex-col gap-3" role="status" aria-label="Loading lead">
          <Skeleton className="h-9 w-1/2" />
          <Skeleton className="h-64" />
        </div>
      )}
      {notFound && <ErrorState title={copy.leadNotFound} description={copy.leadNotFoundBody} />}
      {lead.isError && !notFound && (
        <ErrorState description={copy.leadLoadFailed} onRetry={() => void lead.refetch()} />
      )}
      {lead.isSuccess && (
        <>
          <Link
            to={`/plans/${lead.data.planId}/leads`}
            className="text-sm text-accent hover:underline"
          >
            ← {planName}
          </Link>
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">
                {lead.data.name}
              </h1>
              <p className="m-0 mt-1 text-sm text-muted">
                {[lead.data.category, lead.data.address].filter(Boolean).join(' · ')}
                {lead.data.distanceMiles !== null &&
                  ` · ${fill(copy.fromYou, { miles: formatMiles(lead.data.distanceMiles) ?? '' })}`}
              </p>
            </div>
            <div className="flex flex-col items-center gap-1">
              <ScoreBadge score={lead.data.fitScore} />
              <span className="text-xs text-muted">{copy.fitScore}</span>
            </div>
          </header>
          <div className="grid gap-8 md:grid-cols-[3fr_2fr]">
            <div className="flex min-w-0 flex-col gap-6">
              <section className="flex flex-col gap-2">
                <h2 className={sectionTitle}>{copy.contacts}</h2>
                <ContactTable contacts={lead.data.contacts} />
              </section>
              <section className="flex flex-col gap-2">
                <h2 className={sectionTitle}>{copy.evidence}</h2>
                <EvidenceList evidence={lead.data.evidence} />
              </section>
            </div>
            <aside className="flex flex-col gap-5">
              <PitchCard pitch={lead.data.pitch} />
              <FeedbackControls key={lead.data.id} lead={lead.data} actions={actions} />
              <p className="m-0 text-[13px] text-muted">
                {fill(copy.foundIn, {
                  date: formatDate(lead.data.deliveredAt),
                  plan: planName,
                })}
              </p>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
