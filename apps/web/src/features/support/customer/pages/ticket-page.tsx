import { categoryLabels, ticketParams, type TicketDetail } from '@app/contracts/support';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../../../../shared/api/client';
import { Button, Dialog, EmptyState, ErrorState, Skeleton } from '../../../../shared/ui';
import { copy, fill } from '../../copy';
import { useCloseTicket, useTicket } from '../api/hooks';
import { BackLink } from '../components/back-link';
import { Composer } from '../components/composer';
import { RunCard } from '../components/run-card';
import { Fact, Facts, SidePanel } from '../components/side-panel';
import { StatusWord } from '../components/status-word';
import { Thread } from '../components/thread';
import { formatDateTime } from '../lib/format';

function Loading() {
  return (
    <div role="status" aria-label={copy.loadingTicket} className="flex flex-col gap-4 p-4 md:p-7">
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-16 w-1/2" />
      <Skeleton className="h-24 w-2/3" />
    </div>
  );
}

function NotFound() {
  return (
    <EmptyState
      title={copy.ticketNotFound}
      description={copy.ticketNotFoundBody}
      action={
        <Link
          to="/support"
          className="inline-flex h-10 items-center rounded-control border border-line-control px-4 text-sm font-medium text-fg hover:bg-surface"
        >
          {copy.backToList}
        </Link>
      }
    />
  );
}

function CloseDialog({ number, onDone }: { number: number; onDone: () => void }) {
  const close = useCloseTicket(number);
  return (
    <Dialog
      open
      onClose={onDone}
      title={fill(copy.closeTitle, { number })}
      footer={
        <>
          <Button onClick={onDone}>{copy.keepOpen}</Button>
          <Button
            variant="primary"
            loading={close.isPending}
            onClick={() =>
              close.mutate(undefined, {
                onSuccess: onDone,
                onError: (error) => {
                  // Already closed: the thread refreshes behind the dialog (FR-5).
                  if (error instanceof ApiError && error.status === 409) onDone();
                },
              })
            }
          >
            {copy.closeConfirm}
          </Button>
        </>
      }
    >
      <p className="m-0">{copy.closeBody}</p>
      {close.isError && !(close.error instanceof ApiError && close.error.status === 409) && (
        <p role="alert" className="m-0 mt-2 text-danger">
          {copy.closeFailed}
        </p>
      )}
    </Dialog>
  );
}

function TicketView({ ticket }: { ticket: TicketDetail }) {
  const [closing, setClosing] = useState(false);
  const [tooLongAt, setTooLongAt] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const focusNext = useRef(false);

  // After sending, focus moves to the new message (NFR-3).
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    (list.current?.lastElementChild as HTMLElement | null)?.focus();
  }, [ticket.messages.length]);

  const opener = ticket.openedBy.name;
  const category = categoryLabels[ticket.category];
  return (
    <div className="flex min-h-full flex-col min-[1000px]:flex-row">
      <div className="flex min-w-0 flex-[3] flex-col">
        <header className="flex flex-col gap-1.5 px-4 pb-2 pt-3 md:px-7 md:pt-7">
          <div className="flex items-center gap-1.5 md:hidden">
            <BackLink />
            <span className="font-mono text-[13px] text-muted">#{ticket.number}</span>
            <span className="flex-1" />
            <StatusWord status={ticket.status} pill />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="m-0 text-xl font-semibold tracking-tight text-fg md:text-[28px]">
              {ticket.subject}
            </h1>
            <StatusWord status={ticket.status} pill className="max-md:hidden" />
          </div>
          <p className="m-0 text-[13px] text-muted md:text-sm">
            <span className="font-mono max-md:hidden">#{ticket.number} · </span>
            {category} ·{' '}
            {fill(copy.openedBy, { name: opener, when: formatDateTime(ticket.createdAt) })}
          </p>
        </header>
        {ticket.run && (
          <div className="px-4 pb-2 min-[1000px]:hidden">
            <RunCard run={ticket.run} />
          </div>
        )}
        <div className="flex-1 px-4 py-4 md:max-w-[820px] md:px-7 md:py-5">
          <Thread ref={list} messages={ticket.messages} />
        </div>
        <div className="md:max-w-[820px]">
          <Composer
            ticket={ticket}
            onSent={() => {
              focusNext.current = true;
            }}
            onClose={() => setClosing(true)}
            closedTooLongAt={tooLongAt}
            onTooLong={setTooLongAt}
          />
        </div>
      </div>
      <SidePanel title={copy.detailsTitle} className="max-[999px]:hidden">
        <Facts>
          <Fact label={copy.detailStatus}>
            <StatusWord status={ticket.status} />
          </Fact>
          <Fact label={copy.detailCategory}>{category}</Fact>
          <Fact label={copy.detailOpened}>
            <span className="font-mono text-[13px]">{formatDateTime(ticket.createdAt)}</span>
          </Fact>
          <Fact label={copy.detailFrom}>{opener}</Fact>
        </Facts>
        {ticket.run && (
          <>
            <h3 className="m-0 mt-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              {copy.linkedRunTitle}
            </h3>
            <RunCard run={ticket.run} />
          </>
        )}
      </SidePanel>
      {closing && <CloseDialog number={ticket.number} onDone={() => setClosing(false)} />}
    </div>
  );
}

/** FR-4, FR-5: the thread at /app/support/:number. */
export function CustomerTicketPage() {
  const params = useParams();
  const parsed = ticketParams.safeParse({ number: params.number });
  if (!parsed.success) return <NotFound />;
  return <TicketLoader number={parsed.data.number} key={parsed.data.number} />;
}

function TicketLoader({ number }: { number: number }) {
  const ticket = useTicket(number);
  if (ticket.isPending) return <Loading />;
  if (ticket.isError) {
    if (ticket.error instanceof ApiError && ticket.error.status === 404) return <NotFound />;
    return <ErrorState description={copy.ticketLoadFailed} onRetry={() => void ticket.refetch()} />;
  }
  return <TicketView ticket={ticket.data} />;
}
