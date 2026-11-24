import {
  assigneeFilter,
  category,
  categoryLabels,
  staffView,
  type AssigneeFilter,
  type Category,
  type StaffView,
} from '@app/contracts/support';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useMe } from '../../../../shared/api/me';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  Select,
  Skeleton,
  StatTile,
} from '../../../../shared/ui';
import { useStaffTickets, useSupportStaff } from '../api/hooks';
import { DeskCards, DeskTable } from '../components/desk-list';
import { copy } from '../copy';
import { formatPct, formatWait } from '../lib/format';
import { useIsMobile } from '../lib/use-is-mobile';

const views: { id: StaffView; label: string }[] = [
  { id: 'waiting', label: copy.viewWaiting },
  { id: 'mine', label: copy.viewMine },
  { id: 'waiting_on_customer', label: copy.viewWaitingOnCustomer },
  { id: 'closed', label: copy.viewClosed },
  { id: 'all', label: copy.viewAll },
];

/** FR-6: the Support desk. */
export function StaffSupportDeskPage() {
  const [params, setParams] = useSearchParams();
  const view: StaffView = staffView.safeParse(params.get('view')).data ?? 'waiting';
  const cat: Category | undefined = category.safeParse(params.get('category')).data;
  const assignee: AssigneeFilter | undefined = assigneeFilter.safeParse(
    params.get('assignee'),
  ).data;
  const list = useStaffTickets({ view, category: cat, assignee });
  const staff = useSupportStaff();
  const { me } = useMe();
  const isMobile = useIsMobile();
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const first = list.data?.pages[0];

  function update(key: string, value: string | null) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  }

  const counts: Partial<Record<StaffView, number>> = first
    ? {
        waiting: first.counts.waiting,
        mine: first.counts.mine,
        waiting_on_customer: first.counts.waitingOnCustomer,
      }
    : {};
  const filtered = cat !== undefined || assignee !== undefined;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-8 md:px-7">
      <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">{copy.title}</h1>

      <div className="grid grid-cols-2 overflow-hidden rounded-card border border-line-strong bg-surface md:grid-cols-4">
        <StatTile label={copy.statWaiting} value={first ? first.stats.waiting : null} />
        <StatTile
          label={copy.statLongest}
          value={first ? formatWait(first.stats.longestWaitMinutes) : null}
        />
        <StatTile
          label={copy.statFirstReply}
          value={first ? formatWait(first.stats.firstReplyMedianBusinessMinutes30d) : null}
        />
        <StatTile
          label={copy.statClosed}
          value={first ? formatPct(first.stats.closedWithin3DaysPct30d) : null}
        />
      </div>

      <div role="group" aria-label={copy.viewsLabel} className="flex flex-wrap gap-2">
        {views.map((v) => {
          const n = counts[v.id];
          return (
            <Chip
              key={v.id}
              selected={view === v.id}
              onSelectedChange={() => update('view', v.id === 'waiting' ? null : v.id)}
            >
              {n === undefined ? v.label : `${v.label} ${n}`}
            </Chip>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-56">
          <Field label={copy.filterCategory}>
            {(p) => (
              <Select {...p} value={cat ?? ''} onChange={(e) => update('category', e.target.value)}>
                <option value="">{copy.allCategories}</option>
                {category.options.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabels[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="w-full sm:w-56">
          <Field label={copy.filterAssignee}>
            {(p) => (
              <Select
                {...p}
                value={assignee ?? ''}
                onChange={(e) => update('assignee', e.target.value)}
              >
                <option value="">{copy.anyone}</option>
                <option value="me">{copy.me}</option>
                <option value="nobody">{copy.nobodyOption}</option>
                {(staff.data?.items ?? [])
                  .filter((s) => s.id !== me?.member.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </div>
      </div>

      {list.isPending && (
        <div className="flex flex-col gap-2" role="status" aria-label={copy.loadingDesk}>
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      )}
      {list.isError && (
        <ErrorState
          title={copy.loadFailed}
          description={copy.loadFailedBody}
          retryLabel={copy.retry}
          onRetry={() => void list.refetch()}
        />
      )}
      {list.isSuccess &&
        (rows.length === 0 ? (
          view === 'waiting' && !filtered ? (
            <EmptyState
              title={copy.emptyWaitingTitle}
              description={copy.emptyWaitingBody}
              action={<Button onClick={() => update('view', 'all')}>{copy.seeAll}</Button>}
            />
          ) : (
            <EmptyState title={copy.emptyTitle} description={copy.emptyBody} />
          )
        ) : (
          <>
            {isMobile ? (
              <DeskCards rows={rows} meId={me?.member.id} />
            ) : (
              <DeskTable rows={rows} meId={me?.member.id} emptyTitle={copy.emptyTitle} />
            )}
            {list.hasNextPage && (
              <Button
                className="self-center"
                loading={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {copy.more}
              </Button>
            )}
            <p className="m-0 text-[13px] text-faint">{copy.footnote}</p>
          </>
        ))}
    </div>
  );
}
