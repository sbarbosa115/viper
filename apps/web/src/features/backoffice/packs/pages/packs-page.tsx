import type { CreditPack } from '@app/contracts/billing';
import { useState } from 'react';
import { Badge, Button, ErrorState, Skeleton, Table, type Column } from '../../../../shared/ui';
import { usePacks } from '../api/hooks';
import { PackForm } from '../components/pack-form';
import { copy } from '../copy';
import { bonusPercent, formatCredits, formatUsd } from '../lib/format';

type Editing = { pack: CreditPack | null } | null;

/** FR-13: list, edit and create Credit packs. */
export function PacksPage() {
  const packs = usePacks();
  const [editing, setEditing] = useState<Editing>(null);

  const columns: Column<CreditPack>[] = [
    {
      key: 'name',
      header: copy.colPack,
      cell: (p) => <span className="font-medium text-fg">{p.name}</span>,
    },
    {
      key: 'credits',
      header: copy.colCredits,
      numeric: true,
      cell: (p) => formatCredits(p.credits),
    },
    { key: 'price', header: copy.colPrice, numeric: true, cell: (p) => formatUsd(p.priceCents) },
    {
      key: 'bonus',
      header: copy.colBonus,
      numeric: true,
      cell: (p) => `${bonusPercent(p.credits, p.priceCents)}%`,
    },
    {
      key: 'status',
      header: copy.colStatus,
      cell: (p) => (
        <Badge tone={p.active ? 'accent' : 'neutral'}>{p.active ? copy.active : copy.hidden}</Badge>
      ),
    },
    {
      key: 'edit',
      header: '',
      cell: (p) => (
        <Button
          size="sm"
          aria-label={`${copy.edit} ${p.name}`}
          onClick={() => setEditing({ pack: p })}
        >
          {copy.edit}
        </Button>
      ),
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-8 md:px-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">{copy.title}</h1>
        <Button variant="primary" onClick={() => setEditing({ pack: null })}>
          {copy.newPack}
        </Button>
      </div>
      <p className="m-0 text-sm text-muted">{copy.intro}</p>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          {packs.isPending && (
            <div className="flex flex-col gap-2" role="status" aria-label="Loading packs">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          )}
          {packs.isError && (
            <ErrorState title={copy.loadFailed} onRetry={() => void packs.refetch()} />
          )}
          {packs.isSuccess && (
            <Table
              caption={copy.caption}
              columns={columns}
              rows={packs.data.items}
              rowKey={(p) => p.id}
              emptyTitle={copy.emptyTitle}
              emptyDescription={copy.emptyHint}
            />
          )}
        </div>
        {editing && (
          <PackForm
            key={editing.pack?.id ?? 'new'}
            pack={editing.pack}
            onDone={() => setEditing(null)}
          />
        )}
      </div>
    </div>
  );
}
