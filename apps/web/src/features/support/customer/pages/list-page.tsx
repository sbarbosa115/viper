import type { TicketListFilter } from '@app/contracts/support';
import { useSearchParams } from 'react-router';
import { useMe } from '../../../../shared/api/me';
import { Button, Chip, EmptyState, ErrorState, Skeleton } from '../../../../shared/ui';
import { copy, fill } from '../../copy';
import { useTickets } from '../api/hooks';
import { NewTicketButton } from '../components/new-ticket-button';
import { SidePanel } from '../components/side-panel';
import { TicketHead, TicketRow } from '../components/ticket-rows';

const filters: { id: TicketListFilter; label: string }[] = [
  { id: 'open', label: copy.filterOpen },
  { id: 'closed', label: copy.filterClosed },
  { id: 'all', label: copy.filterAll },
];

function parseFilter(value: string | null): TicketListFilter {
  return value === 'closed' || value === 'all' ? value : 'open';
}

function Skeletons() {
  return (
    <div role="status" aria-label={copy.loadingTickets} className="flex flex-col gap-3 p-4">
      <Skeleton className="h-14" />
      <Skeleton className="h-14" />
      <Skeleton className="h-14" />
    </div>
  );
}

/** FR-1: Your tickets at /app/support. */
export function CustomerSupportListPage() {
  const [params, setParams] = useSearchParams();
  const filter = parseFilter(params.get('status'));
  const { me } = useMe();
  const actingAs = me?.actingAs != null;
  const tickets = useTickets(filter);

  const first = tickets.data?.pages[0];
  const items = tickets.data?.pages.flatMap((p) => p.items) ?? [];
  const counts = first?.counts;
  const showFrom = first?.showFrom ?? false;
  const total = counts ? counts.open + counts.closed : 0;
  const countOf = (id: TicketListFilter) =>
    counts ? (id === 'all' ? total : counts[id]) : undefined;

  let body;
  if (tickets.isPending) body = <Skeletons />;
  else if (tickets.isError) {
    body = <ErrorState description={copy.loadFailed} onRetry={() => void tickets.refetch()} />;
  } else if (total === 0) {
    body = (
      <EmptyState
        title={copy.emptyTitle}
        description={copy.emptyBody}
        action={<NewTicketButton actingAs={actingAs} />}
      />
    );
  } else if (items.length === 0) {
    body =
      filter === 'closed' ? (
        <EmptyState title={copy.emptyClosedTitle} description={copy.emptyClosedBody} />
      ) : (
        <EmptyState title={copy.emptyOpenTitle} description={copy.emptyOpenBody} />
      );
  } else {
    body = (
      <>
        <TicketHead showFrom={showFrom} />
        <ul aria-label={copy.ticketsLabel} className="m-0 list-none p-0">
          {items.map((ticket) => (
            <TicketRow key={ticket.number} ticket={ticket} showFrom={showFrom} />
          ))}
        </ul>
        {tickets.hasNextPage && (
          <div className="flex justify-center p-3">
            <Button
              loading={tickets.isFetchingNextPage}
              onClick={() => void tickets.fetchNextPage()}
            >
              {copy.showMore}
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex min-h-full flex-col min-[1000px]:flex-row">
      <div className="flex min-w-0 flex-[3] flex-col gap-4 px-4 py-5 md:gap-[18px] md:p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="m-0 text-xs text-muted md:hidden">{copy.listBreadcrumb}</p>
            <h1 className="m-0 mt-0.5 text-[26px] font-semibold tracking-tight text-fg md:text-3xl">
              {copy.listTitle}
            </h1>
            {showFrom && me && (
              <p className="m-0 mt-1 hidden text-sm text-muted md:block">
                {fill(copy.listOwnerNote, { business: me.business.name })}
              </p>
            )}
          </div>
          <NewTicketButton actingAs={actingAs} className="max-md:w-full" />
        </div>
        <div role="group" aria-label={copy.filtersLabel} className="flex gap-2">
          {filters.map((f) => {
            const count = countOf(f.id);
            return (
              <Chip
                key={f.id}
                selected={filter === f.id}
                onSelectedChange={() =>
                  setParams(f.id === 'open' ? {} : { status: f.id }, { replace: true })
                }
              >
                {count === undefined ? f.label : `${f.label} ${count}`}
              </Chip>
            );
          })}
        </div>
        <div className="overflow-hidden rounded-card border border-line-strong bg-surface">
          {body}
        </div>
      </div>
      <SidePanel title={copy.howTitle}>
        <p className="m-0 text-[15px] leading-relaxed text-fg-2">{copy.howReply}</p>
        <p className="m-0 text-sm leading-relaxed text-muted">{copy.howNoCharge}</p>
        <p className="m-0 text-[13px] text-faint">{copy.howLimit}</p>
      </SidePanel>
    </div>
  );
}
