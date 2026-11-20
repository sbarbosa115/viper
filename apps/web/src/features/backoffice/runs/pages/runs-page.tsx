import { runStatus, type RunStatus as Status, type StaffRunSummary } from '@app/contracts/research';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Select,
  Skeleton,
  Table,
  type Column,
} from '../../../../shared/ui';
import { noRunFilters, useRunBusinesses, useStaffRuns, type RunFilters } from '../api/hooks';
import { QueueStrip } from '../components/queue-strip';
import { RunStatus } from '../components/run-status';
import { copy, fill } from '../copy';
import { formatDuration, formatFlow, formatInt, formatUsd } from '../lib/format';

const unfinished = new Set<Status>(['queued', 'running', 'retrying']);

const columns: Column<StaffRunSummary>[] = [
  {
    key: 'business',
    header: copy.colBusiness,
    cell: (r) => <span className="font-medium text-fg">{r.business.name}</span>,
  },
  { key: 'plan', header: copy.colPlan, cell: (r) => r.planName },
  { key: 'flow', header: copy.colFlow, cell: (r) => formatFlow(r.flow.key, r.flow.version) },
  { key: 'status', header: copy.colStatus, cell: (r) => <RunStatus run={r} /> },
  {
    key: 'attempts',
    header: copy.colAttempts,
    numeric: true,
    cell: (r) => `${r.attempt.current}/${r.attempt.max}`,
  },
  {
    key: 'startedBy',
    header: copy.colStartedBy,
    cell: (r) => (r.startedBy === 'staff' ? copy.staff : copy.owner),
  },
  {
    key: 'duration',
    header: copy.colDuration,
    numeric: true,
    cell: (r) => formatDuration(r.durationS),
  },
  {
    key: 'credits',
    header: copy.colCredits,
    numeric: true,
    cell: (r) => formatInt(r.creditsSpent),
  },
  {
    key: 'provider',
    header: copy.colProvider,
    numeric: true,
    cell: (r) => formatUsd(r.providerCostMicros),
  },
  {
    key: 'leads',
    header: copy.colLeads,
    numeric: true,
    cell: (r) => (unfinished.has(r.status) ? copy.none : formatInt(r.leadsDelivered)),
  },
  {
    key: 'open',
    header: '',
    cell: (r) => (
      <Link
        to={`/staff/runs/${r.id}`}
        aria-label={fill(copy.openRun, { business: r.business.name })}
        className="text-accent hover:underline"
      >
        {copy.open}
      </Link>
    ),
  },
];

/** FR-32: the runs monitor with queue health, status and Business filters. */
export function RunsPage() {
  const [filters, setFilters] = useState<RunFilters>(noRunFilters);
  const list = useStaffRuns(filters);
  const choices = useRunBusinesses();
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const businesses = useMemo(() => {
    const seen = new Map<string, string>();
    for (const run of [...(choices.data?.items ?? []), ...rows]) {
      seen.set(run.business.id, run.business.name);
    }
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }, [choices.data, rows]);
  const filtered = Boolean(filters.status || filters.businessId);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-8 md:px-7">
      <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">{copy.title}</h1>
      <QueueStrip />
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Field label={copy.filterStatus}>
            {(p) => (
              <Select
                {...p}
                value={filters.status}
                onChange={(e) =>
                  setFilters({ ...filters, status: e.target.value as RunFilters['status'] })
                }
              >
                <option value="">{copy.allStatuses}</option>
                {runStatus.options.map((s) => (
                  <option key={s} value={s}>
                    {copy.statuses[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="w-64">
          <Field label={copy.filterBusiness}>
            {(p) => (
              <Select
                {...p}
                value={filters.businessId}
                onChange={(e) => setFilters({ ...filters, businessId: e.target.value })}
              >
                <option value="">{copy.allBusinesses}</option>
                {businesses.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
      {list.isPending && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading runs">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )}
      {list.isError && <ErrorState title={copy.loadFailed} onRetry={() => void list.refetch()} />}
      {list.isSuccess &&
        (rows.length === 0 ? (
          <EmptyState
            title={copy.emptyTitle}
            description={filtered ? copy.emptyFiltered : copy.emptyAll}
          />
        ) : (
          <>
            <Table caption={copy.caption} columns={columns} rows={rows} rowKey={(r) => r.id} />
            {list.hasNextPage && (
              <Button
                className="self-center"
                loading={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {copy.more}
              </Button>
            )}
          </>
        ))}
    </div>
  );
}
