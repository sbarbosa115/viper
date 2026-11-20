import type { FlowListItem } from '@app/contracts/research';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '../../../../shared/ui';
import { useFlow, useFlows } from '../api/hooks';
import { FlowEditor } from '../components/flow-editor';
import { copy, fill } from '../copy';

const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

function Loading({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label={label}>
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  );
}

function FlowList({
  items,
  selected,
  onSelect,
}: {
  items: FlowListItem[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  return (
    <section aria-label={copy.flows} className="flex flex-col gap-2">
      <h2 className="m-0 text-sm font-semibold uppercase tracking-[0.08em] text-muted">
        {copy.flows}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((f) => (
          <li key={f.key}>
            <Card
              tone={f.key === selected ? 'accent' : 'default'}
              className="flex flex-wrap items-center justify-between gap-3 !p-4"
            >
              <div>
                <p className="m-0 flex items-center gap-2 font-medium text-fg">
                  {f.name} <Badge>v{f.version}</Badge>
                  {f.isDefault && <span className="text-xs text-accent">{copy.defaultBadge}</span>}
                </p>
                <p className="m-0 mt-1 text-xs text-muted">
                  {fill(f.plansUsing === 1 ? copy.usedByOne : copy.usedBy, {
                    n: f.plansUsing,
                    date: day.format(new Date(f.updatedAt)),
                  })}
                </p>
              </div>
              <Button
                size="sm"
                aria-label={fill(copy.edit, { name: f.name })}
                aria-pressed={f.key === selected}
                onClick={() => onSelect(f.key)}
              >
                {copy.editShort}
              </Button>
            </Card>
          </li>
        ))}
      </ul>
      <p className="m-0 text-xs text-faint">{copy.more}</p>
    </section>
  );
}

/** FR-37: the flow list and the settings editor for the selected flow. */
export function FlowsPage() {
  const list = useFlows();
  const [picked, setPicked] = useState<string | null>(null);
  const items = list.data?.items ?? [];
  const selected = picked ?? items.find((f) => f.isDefault)?.key ?? items[0]?.key ?? null;
  const flow = useFlow(selected);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-7">
      <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">{copy.title}</h1>
      {list.isPending && <Loading label="Loading flows" />}
      {list.isError && <ErrorState title={copy.listFailed} onRetry={() => void list.refetch()} />}
      {list.isSuccess && items.length === 0 && (
        <EmptyState title={copy.emptyTitle} description={copy.emptyHint} />
      )}
      {list.isSuccess && selected && (
        <>
          <FlowList items={items} selected={selected} onSelect={setPicked} />
          {flow.isPending && <Loading label="Loading flow" />}
          {flow.isError && (
            <ErrorState title={copy.loadFailed} onRetry={() => void flow.refetch()} />
          )}
          {flow.isSuccess && <FlowEditor key={flow.data.key} flow={flow.data} />}
        </>
      )}
    </div>
  );
}
