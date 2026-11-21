import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../../shared/api/client';
import { Button, ErrorState, KeyboardHint, Select, Skeleton, SplitView } from '../../../shared/ui';
import { useLead, useLeadList, usePlan, usePlanChoices, usePlanRuns } from '../api/hooks';
import { useFeedbackActions } from '../api/use-feedback';
import { NoLeads, NoMatches } from '../components/empty-states';
import { FiltersBar } from '../components/filters-bar';
import { LeadPreview } from '../components/lead-preview';
import { LeadRows } from '../components/lead-rows';
import { StatsStrip } from '../components/stats-strip';
import { copy } from '../copy';
import {
  filtersToQuery,
  filtersToSearch,
  hasActiveFilters,
  parseFilters,
  type FilterValues,
} from '../lib/filters';
import { useIsPhone } from '../lib/use-media';
import { useShortcuts } from '../lib/use-shortcuts';

/** FR-26: the Lead list with its preview at /app/plans/:id/leads. */
export function LeadsPage() {
  const { id = '' } = useParams();
  return <LeadsView key={id} planId={id} />;
}

function LeadsView({ planId }: { planId: string }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const list = useLeadList(planId, filters);
  const plan = usePlan(planId);
  const plans = usePlanChoices();
  const runs = usePlanRuns(planId);
  const phone = useIsPhone();
  const { pathname } = useLocation();

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const stats = list.data?.pages[0]?.stats;

  // undefined: the default (the first Lead on wide screens); null: the preview is closed.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const selectedId = picked !== undefined ? picked : phone ? null : (items[0]?.id ?? null);
  const lead = useLead(selectedId);
  const actions = useFeedbackActions(lead.data);

  function change(patch: FilterValues) {
    setParams(filtersToSearch({ ...filters, ...patch }), { replace: true });
    setPicked(undefined);
  }

  function move(delta: 1 | -1) {
    const at = items.findIndex((i) => i.id === selectedId);
    const next = items[Math.min(items.length - 1, Math.max(0, at + delta))];
    if (next) setPicked(next.id);
    if (delta === 1 && at === items.length - 1 && list.hasNextPage) void list.fetchNextPage();
  }

  useShortcuts({
    j: () => move(1),
    k: () => move(-1),
    g: actions.good,
    n: actions.notFit,
    escape: () => setPicked(null),
  });

  useEffect(() => {
    if (!selectedId) return;
    document
      .querySelector(`[data-lead-id="${selectedId}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);

  const planMissing = plan.error instanceof ApiError && plan.error.status === 404;
  if (planMissing) {
    return <ErrorState title={copy.planNotFound} description={copy.planNotFoundBody} />;
  }

  // FR-3: the Plan's latest run (the API lists runs newest first), or none when there is no run.
  const latestRunId = runs.data?.items[0]?.id;
  const reportQuery = new URLSearchParams({
    ...(latestRunId ? { runId: latestRunId } : {}),
    source: 'leads',
    from: `/app${pathname}`,
  }).toString();
  const csv = `/api/plans/${planId}/leads.csv?${filtersToQuery(filters).toString()}`;
  const active = hasActiveFilters(filters);

  const header = (
    <div className="flex flex-wrap items-end gap-4 border-b border-line px-4 py-3">
      <h1 className="sr-only">{copy.title}</h1>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="lead-plan"
          className="text-xs font-semibold uppercase tracking-[0.08em] text-muted"
        >
          {copy.plan}
        </label>
        <Select
          id="lead-plan"
          value={planId}
          onChange={(event) => void navigate(`/plans/${event.target.value}/leads`)}
        >
          {!plans.data?.items.some((p) => p.id === planId) && (
            <option value={planId}>{plan.data?.name ?? '…'}</option>
          )}
          {plans.data?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <Link
        to={`/support/new?${reportQuery}`}
        className="ml-auto inline-flex h-10 items-center rounded-control px-3 text-sm text-muted underline hover:text-fg"
      >
        Report a problem
      </Link>
      <a
        href={csv}
        download
        className="inline-flex h-10 items-center rounded-control border border-line-control px-4 text-sm font-medium text-fg hover:bg-surface"
      >
        {copy.exportCsv}
      </a>
    </div>
  );

  let listPane;
  if (list.isPending) {
    listPane = (
      <div className="flex flex-col gap-2 p-4" role="status" aria-label={copy.loadingLeads}>
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    );
  } else if (list.isError) {
    listPane = <ErrorState description={copy.loadFailed} onRetry={() => void list.refetch()} />;
  } else if (items.length === 0) {
    listPane = active ? (
      <NoMatches
        onClear={() =>
          change({ runId: undefined, minScore: undefined, feedback: undefined, q: undefined })
        }
      />
    ) : (
      <NoLeads planId={planId} lastRun={plan.data?.lastRun} />
    );
  } else {
    listPane = (
      <>
        <LeadRows leads={items} selectedId={selectedId} onSelect={setPicked} />
        {list.hasNextPage && (
          <div className="flex justify-center p-3">
            <Button loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              {copy.loadMore}
            </Button>
          </div>
        )}
        <p className="m-0 hidden flex-wrap items-center gap-1.5 px-4 py-3 text-xs text-muted min-[1000px]:flex">
          <KeyboardHint>J</KeyboardHint>
          <KeyboardHint>K</KeyboardHint>
          {copy.hintMove}
          <KeyboardHint>G</KeyboardHint>
          <KeyboardHint>N</KeyboardHint>
          {copy.hintFeedback}
          <KeyboardHint>Esc</KeyboardHint>
          {copy.hintClose}
        </p>
      </>
    );
  }

  let previewPane;
  if (selectedId === null) {
    previewPane = <p className="m-0 p-6 text-sm text-muted">{copy.noPreview}</p>;
  } else if (lead.isPending) {
    previewPane = (
      <div className="flex flex-col gap-3 p-5" role="status" aria-label="Loading lead">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-32" />
      </div>
    );
  } else if (lead.isError) {
    previewPane = (
      <ErrorState description={copy.leadLoadFailed} onRetry={() => void lead.refetch()} />
    );
  } else {
    previewPane = (
      <LeadPreview lead={lead.data} actions={actions} onClose={() => setPicked(null)} />
    );
  }

  const toolbar = (
    <>
      {header}
      {stats && <StatsStrip stats={stats} />}
      <FiltersBar filters={filters} runs={runs.data?.items ?? []} onChange={change} />
    </>
  );

  return (
    <div className="flex min-h-[calc(100vh-var(--header-height))] flex-col min-[1000px]:h-[calc(100vh-var(--header-height))]">
      {phone && selectedId !== null ? (
        <>
          <div className="border-b border-line px-4 py-2">
            <Button variant="ghost" onClick={() => setPicked(null)}>
              ← {copy.backToList}
            </Button>
          </div>
          <div className="min-w-0 flex-1 bg-sunken" aria-label={copy.previewLabel} role="region">
            {previewPane}
          </div>
        </>
      ) : phone ? (
        <>
          {toolbar}
          {listPane}
        </>
      ) : (
        <>
          {toolbar}
          <SplitView
            list={listPane}
            preview={previewPane}
            listLabel={copy.listLabel}
            previewLabel={copy.previewLabel}
          />
        </>
      )}
    </div>
  );
}
