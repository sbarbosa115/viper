import type { Customer } from '@app/contracts/reporting';
import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Select,
  Skeleton,
  Table,
  type Column,
} from '../../../../shared/ui';
import {
  useActAs,
  useCustomers,
  useSetInternal,
  type CustomerFilters,
  type CustomerSort,
} from '../api/hooks';
import { GrantDialog } from '../components/grant-dialog';
import { copy } from '../copy';
import { formatCredits, formatDay, formatLastActive } from '../lib/format';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** FR-31: the customer list with Act as (FR-6), Grant credits (FR-13) and Mark internal. */
export function CustomersPage() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<CustomerSort>('signedUp');
  const q = useDebounced(search.trim(), 250);
  const filters: CustomerFilters = { q, sort };
  const list = useCustomers(filters);
  const actAs = useActAs();
  const setInternal = useSetInternal();
  const [granting, setGranting] = useState<Customer | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);

  const columns: Column<Customer>[] = [
    {
      key: 'business',
      header: copy.colBusiness,
      cell: (c) => (
        <span className="flex items-center gap-2 font-medium text-fg">
          {c.name}
          {c.internal && <Badge>{copy.internal}</Badge>}
        </span>
      ),
    },
    { key: 'owner', header: copy.colOwner, cell: (c) => c.ownerEmail },
    { key: 'signedUp', header: copy.colSignedUp, cell: (c) => formatDay(c.signedUpAt) },
    { key: 'verified', header: copy.colVerified, cell: (c) => (c.verified ? copy.yes : copy.no) },
    {
      key: 'available',
      header: copy.colAvailable,
      numeric: true,
      cell: (c) => formatCredits(c.availableCredits),
    },
    { key: 'runs', header: copy.colRuns, numeric: true, cell: (c) => formatCredits(c.runs) },
    {
      key: 'leads',
      header: copy.colLeads,
      numeric: true,
      cell: (c) => formatCredits(c.leadsDelivered),
    },
    { key: 'last', header: copy.colLastActive, cell: (c) => formatLastActive(c.lastActiveAt) },
    { key: 'paying', header: copy.colPaying, cell: (c) => (c.paying ? copy.yes : copy.no) },
    {
      key: 'actions',
      header: copy.colActions,
      cell: (c) => (
        <div className="flex gap-1.5">
          <Button
            size="sm"
            aria-label={`${copy.actAs} ${c.name}`}
            onClick={() => actAs.mutate(c.id)}
          >
            {copy.actAs}
          </Button>
          <Button
            size="sm"
            aria-label={`${copy.grant} ${c.name}`}
            onClick={() => {
              setNotice(null);
              setGranting(c);
            }}
          >
            {copy.grant}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${c.internal ? copy.unmarkInternal : copy.markInternal} ${c.name}`}
            onClick={() => setInternal.mutate({ id: c.id, internal: !c.internal })}
          >
            {c.internal ? copy.unmarkInternal : copy.markInternal}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-8 md:px-7">
      <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">{copy.title}</h1>
      <p className="m-0 text-sm text-muted">{copy.intro}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm">
          <Field label={copy.search}>
            {(p) => (
              <Input
                {...p}
                type="search"
                placeholder={copy.searchPlaceholder}
                autoComplete="off"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="w-52">
          <Field label={copy.sortBy}>
            {(p) => (
              <Select {...p} value={sort} onChange={(e) => setSort(e.target.value as CustomerSort)}>
                <option value="signedUp">{copy.sortSignedUp}</option>
                <option value="lastActive">{copy.sortLastActive}</option>
              </Select>
            )}
          </Field>
        </div>
      </div>
      {notice && <Banner>{notice}</Banner>}
      {actAs.isError && <Banner tone="warn">{copy.actAsFailed}</Banner>}
      {setInternal.isError && <Banner tone="warn">{copy.internalFailed}</Banner>}
      {list.isPending && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading customers">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )}
      {list.isError && <ErrorState title={copy.loadFailed} onRetry={() => void list.refetch()} />}
      {list.isSuccess &&
        (rows.length === 0 ? (
          <EmptyState title={copy.emptyTitle} description={q ? copy.emptySearch : copy.emptyAll} />
        ) : (
          <>
            <Table caption={copy.caption} columns={columns} rows={rows} rowKey={(c) => c.id} />
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
      {granting && (
        <GrantDialog
          key={granting.id}
          customer={granting}
          onClose={() => setGranting(null)}
          onGranted={(message) => {
            setGranting(null);
            setNotice(message);
          }}
        />
      )}
    </div>
  );
}
