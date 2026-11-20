import type { LedgerEntry } from '@app/contracts/billing';
import { Button, EmptyState, ErrorState, Skeleton, Table, type Column } from '../../../shared/ui';
import { useLedger } from '../api/hooks';
import { copy } from '../copy';
import { formatShortDate, formatSignedCredits } from '../lib/format';

const columns: Column<LedgerEntry>[] = [
  { key: 'date', header: copy.colDate, cell: (e) => formatShortDate(e.createdAt) },
  {
    key: 'description',
    header: copy.colDescription,
    cell: (e) => (
      <>
        {e.description} <span className="text-faint">· {e.type}</span>
      </>
    ),
  },
  {
    key: 'credits',
    header: copy.colCredits,
    numeric: true,
    cell: (e) => (
      <span className={e.credits > 0 ? 'text-accent' : undefined}>
        {formatSignedCredits(e.credits)}
      </span>
    ),
  },
];

/** The ledger, newest first, with cursor pagination. */
export function History() {
  const ledger = useLedger();

  return (
    <section aria-labelledby="credits-history" className="flex flex-col gap-3">
      <h2 id="credits-history" className="m-0 text-lg font-semibold text-fg">
        {copy.historyTitle}
      </h2>
      {ledger.isPending && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading history">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )}
      {ledger.isError && <ErrorState onRetry={() => void ledger.refetch()} />}
      {ledger.isSuccess &&
        (ledger.data.pages[0]?.items.length ? (
          <>
            <Table
              caption={copy.historyCaption}
              columns={columns}
              rows={ledger.data.pages.flatMap((p) => p.items)}
              rowKey={(e) => e.id}
            />
            {ledger.hasNextPage && (
              <Button
                className="self-center"
                loading={ledger.isFetchingNextPage}
                onClick={() => void ledger.fetchNextPage()}
              >
                {copy.more}
              </Button>
            )}
          </>
        ) : (
          <EmptyState
            headingLevel={3}
            title={copy.emptyHistory}
            description={copy.emptyHistoryHint}
          />
        ))}
    </section>
  );
}
