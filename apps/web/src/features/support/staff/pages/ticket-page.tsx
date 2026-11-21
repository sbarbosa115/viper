import {
  categoryLabels,
  status,
  ticketParams,
  type StaffTicketDetail,
} from '@app/contracts/support';
import { Link, useParams } from 'react-router';
import { ApiError } from '../../../../shared/api/client';
import { useMe } from '../../../../shared/api/me';
import { Badge, Banner, Button, ErrorState, Field, Select, Skeleton } from '../../../../shared/ui';
import {
  isVersionConflict,
  useOpenAsBusiness,
  useStaffTicket,
  useSupportStaff,
  useTicketActions,
} from '../api/hooks';
import { Composer } from '../components/composer';
import { SidePanel } from '../components/side-panel';
import { Thread } from '../components/thread';
import { copy } from '../copy';
import { formatDateTime, formatWait } from '../lib/format';

/** FR-7: the Staff ticket view. */
export function StaffTicketPage() {
  const parsed = ticketParams.safeParse(useParams());
  const number = parsed.success ? parsed.data.number : 0;
  const ticket = useStaffTicket(number);

  if (
    !parsed.success ||
    (ticket.isError && ticket.error instanceof ApiError && ticket.error.status === 404)
  ) {
    return (
      <Shell>
        <ErrorState title={copy.ticketNotFound} description={copy.ticketNotFoundBody} />
      </Shell>
    );
  }
  if (ticket.isPending) {
    return (
      <Shell>
        <div className="flex flex-col gap-3" role="status" aria-label={copy.loadingTicket}>
          <Skeleton className="h-10" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </Shell>
    );
  }
  if (ticket.isError) {
    return (
      <Shell>
        <ErrorState
          title={copy.loadFailed}
          retryLabel={copy.retry}
          onRetry={() => void ticket.refetch()}
        />
      </Shell>
    );
  }
  return (
    <Shell>
      <TicketView ticket={ticket.data} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 md:px-7">{children}</div>
  );
}

function errorMessage(error: unknown): string | null {
  if (!error || isVersionConflict(error)) return null;
  if (error instanceof ApiError && error.code === 'TICKET_CLOSED_TOO_LONG')
    return copy.closedTooLong;
  return copy.actionFailed;
}

function TicketView({ ticket }: { ticket: StaffTicketDetail }) {
  const { me } = useMe();
  const meId = me?.member.id;
  const staff = useSupportStaff();
  const actions = useTicketActions(ticket);
  const openAs = useOpenAsBusiness();
  const mine = ticket.assignee?.id === meId;
  const busy =
    actions.take.isPending ||
    actions.assign.isPending ||
    actions.setStatus.isPending ||
    actions.reply.isPending ||
    actions.note.isPending;

  const staffOptions = staff.data?.items ?? [];
  const assigneeKnown = ticket.assignee && staffOptions.some((s) => s.id === ticket.assignee?.id);

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link to="/staff/support" className="text-muted hover:text-fg">
          {copy.back}
        </Link>
        {' / '}
        <span className="font-mono text-fg">#{ticket.number}</span>
      </nav>

      {isVersionConflict(actions.error) && <Banner tone="warn">{copy.conflictBanner}</Banner>}

      <div className="flex flex-wrap items-end gap-3 rounded-card border border-line-strong bg-surface p-4">
        <div className="flex min-w-40 items-center">
          {ticket.assignee === null ? (
            <Button
              variant="primary"
              loading={actions.take.isPending}
              disabled={busy || ticket.status === 'closed'}
              onClick={() => actions.take.mutate()}
            >
              {copy.take}
            </Button>
          ) : (
            <Badge tone={mine ? 'accent' : 'neutral'}>
              {mine ? copy.takenByYou : copy.assignedTo(ticket.assignee.name)}
            </Badge>
          )}
        </div>
        <div className="w-full sm:w-52">
          <Field label={copy.assignee}>
            {(p) => (
              <Select
                {...p}
                disabled={busy}
                value={ticket.assignee?.id ?? ''}
                onChange={(e) => actions.assign.mutate(e.target.value || null)}
              >
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id === meId ? copy.youAssignee(s.name) : s.name}
                  </option>
                ))}
                {ticket.assignee && !assigneeKnown && (
                  <option value={ticket.assignee.id}>{ticket.assignee.name}</option>
                )}
                <option value="">{copy.nobodyAssignee}</option>
              </Select>
            )}
          </Field>
        </div>
        <div className="w-full sm:w-52">
          <Field label={copy.status}>
            {(p) => (
              <Select
                {...p}
                disabled={busy}
                value={ticket.status}
                onChange={(e) => actions.setStatus.mutate(status.parse(e.target.value))}
              >
                {status.options.map((s) => (
                  <option key={s} value={s}>
                    {copy.statusOptions[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <header className="flex flex-col gap-1">
            <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">
              {ticket.subject}
            </h1>
            <p className="m-0 text-sm text-muted">
              {categoryLabels[ticket.category]} · {copy.opened} {formatDateTime(ticket.createdAt)}
              {ticket.businessMinutesToFirstReply !== null &&
                ` · ${copy.firstReplyAfter} ${formatWait(ticket.businessMinutesToFirstReply)}`}
            </p>
          </header>
          <Thread messages={ticket.messages} meId={meId} />
          <Composer
            customerName={ticket.openedBy.name.split(' ')[0] ?? ticket.openedBy.name}
            closed={ticket.status === 'closed'}
            pending={busy}
            errorMessage={errorMessage(actions.error)}
            onReply={(message, then, done) =>
              actions.reply.mutate({ message, ...(then ? { then } : {}) }, { onSuccess: done })
            }
            onClose={() => actions.setStatus.mutate('closed')}
            onNote={(note, done) => actions.note.mutate(note, { onSuccess: done })}
          />
        </div>
        <SidePanel
          ticket={ticket}
          opening={openAs.isPending}
          openFailed={openAs.isError}
          onOpenAs={() =>
            openAs.mutate({ businessId: ticket.business.id, ticketNumber: ticket.number })
          }
        />
      </div>
    </>
  );
}
