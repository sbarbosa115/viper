import type { AuditLogEntry } from '@app/contracts/platform';
import { useMemo, useState } from 'react';
import {
  Button,
  EmptyState,
  ErrorState,
  Skeleton,
  Table,
  type Column,
} from '../../../../shared/ui';
import { noFilters, useAuditChoices, useAuditLog, type AuditFilters } from '../api/hooks';
import { Filters } from '../components/filters';
import { copy } from '../copy';
import { formatStamp, formatTarget } from '../lib/format';

const columns: Column<AuditLogEntry>[] = [
  {
    key: 'time',
    header: copy.colTime,
    cell: (e) => <span className="whitespace-nowrap">{formatStamp(e.at)}</span>,
  },
  { key: 'staff', header: copy.colStaff, cell: (e) => e.staff.email },
  { key: 'business', header: copy.colBusiness, cell: (e) => e.business?.name ?? copy.none },
  {
    key: 'action',
    header: copy.colAction,
    cell: (e) => <code className="font-mono text-[13px]">{e.action}</code>,
  },
  { key: 'target', header: copy.colTarget, cell: (e) => formatTarget(e.targetType, e.targetId) },
  {
    key: 'details',
    header: copy.colDetails,
    cell: (e) => {
      const text = JSON.stringify(e.details);
      return (
        <code title={text} className="block max-w-72 truncate font-mono text-xs text-muted">
          {text}
        </code>
      );
    },
  },
];

/** FR-7: the Audit log, filtered by Business, Staff and Action, with cursor "Load more". */
export function AuditPage() {
  const [filters, setFilters] = useState<AuditFilters>(noFilters);
  const log = useAuditLog(filters);
  const choices = useAuditChoices();
  const rows = useMemo(() => log.data?.pages.flatMap((p) => p.items) ?? [], [log.data]);
  const known = useMemo(() => [...(choices.data?.items ?? []), ...rows], [choices.data, rows]);
  const filtered = Boolean(filters.businessId || filters.staffMemberId || filters.action);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-8 md:px-7">
      <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">{copy.title}</h1>
      <p className="m-0 text-sm text-muted">{copy.intro}</p>
      <Filters value={filters} onChange={setFilters} entries={known} />
      {log.isPending && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading audit log">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )}
      {log.isError && <ErrorState title={copy.loadFailed} onRetry={() => void log.refetch()} />}
      {log.isSuccess &&
        (rows.length === 0 ? (
          <EmptyState
            title={copy.emptyTitle}
            description={filtered ? copy.emptyFiltered : copy.emptyAll}
          />
        ) : (
          <>
            <Table caption={copy.caption} columns={columns} rows={rows} rowKey={(e) => e.id} />
            {log.hasNextPage && (
              <Button
                className="self-center"
                loading={log.isFetchingNextPage}
                onClick={() => void log.fetchNextPage()}
              >
                {copy.more}
              </Button>
            )}
          </>
        ))}
    </div>
  );
}
