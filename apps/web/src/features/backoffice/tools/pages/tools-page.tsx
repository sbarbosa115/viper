import { updateToolBody, type Tool, type UpdateToolBody } from '@app/contracts/tools';
import { useState } from 'react';
import { ApiError } from '../../../../shared/api/client';
import {
  Badge,
  Banner,
  Button,
  ErrorState,
  Input,
  Skeleton,
  Switch,
  Table,
  type Column,
} from '../../../../shared/ui';
import { useTools, useUpdateTool } from '../api/hooks';
import { copy, fill } from '../copy';
import {
  formatCreditsPerUnit,
  formatHealth,
  formatUnitCost,
  isLowMargin,
  marginPct,
} from '../lib/format';

interface Draft {
  enabled: boolean;
  credits: string;
}

type Drafts = Record<string, Draft>;

const toDraft = (t: Tool): Draft => ({
  enabled: t.enabled,
  credits: formatCreditsPerUnit(t.creditsPerUnit),
});

const parseCredits = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text));

function changeOf(tool: Tool, draft: Draft): UpdateToolBody {
  const body: UpdateToolBody = {};
  if (draft.enabled !== tool.enabled) body.enabled = draft.enabled;
  const credits = parseCredits(draft.credits);
  if (credits !== tool.creditsPerUnit) body.creditsPerUnit = credits;
  return body;
}

/** FR-23: the Rate card. Edit enabled and credits per unit, see the margin live, save once. */
export function ToolsPage() {
  const tools = useTools();
  const update = useUpdateTool();
  /** Rows the user has edited; every other row shows the saved values. */
  const [edits, setEdits] = useState<Drafts>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'idle' | 'saved' | 'failed' | 'nothing'>('idle');
  const [saving, setSaving] = useState(false);

  const draftOf = (t: Tool): Draft => edits[t.key] ?? toDraft(t);

  const patch = (tool: Tool, next: Partial<Draft>) => {
    setStatus('idle');
    setEdits((d) => ({ ...d, [tool.key]: { ...draftOf(tool), ...next } }));
  };

  async function onSave() {
    const items = tools.data?.items ?? [];
    const pending: { tool: Tool; body: UpdateToolBody }[] = [];
    const next: Record<string, string> = {};
    for (const tool of items) {
      const body = changeOf(tool, draftOf(tool));
      if (Object.keys(body).length === 0) continue;
      if (!updateToolBody.safeParse(body).success) next[tool.key] = copy.creditsRange;
      else pending.push({ tool, body });
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return setStatus('failed');
    if (pending.length === 0) return setStatus('nothing');
    setSaving(true);
    const results = await Promise.allSettled(
      pending.map(({ tool, body }) => update.mutateAsync({ key: tool.key, body })),
    );
    setSaving(false);
    const failed: Record<string, string> = {};
    results.forEach((r, i) => {
      if (r.status !== 'rejected') return;
      const error: unknown = r.reason;
      failed[pending[i]!.tool.key] =
        error instanceof ApiError && error.fields?.creditsPerUnit
          ? error.fields.creditsPerUnit
          : copy.saveFailed;
    });
    setErrors(failed);
    setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key in failed)));
    setStatus(Object.keys(failed).length > 0 ? 'failed' : 'saved');
  }

  const columns: Column<Tool>[] = [
    {
      key: 'tool',
      header: copy.colTool,
      cell: (t) => (
        <div>
          <div className="font-medium text-fg">{t.name}</div>
          <code className="font-mono text-xs text-faint">{t.key}</code>
        </div>
      ),
    },
    { key: 'provider', header: copy.colProvider, cell: (t) => t.provider },
    { key: 'unit', header: copy.colUnit, cell: (t) => t.unit },
    {
      key: 'cost',
      header: copy.colCost,
      numeric: true,
      cell: (t) => formatUnitCost(t.providerCostMicrosPerUnit),
    },
    {
      key: 'credits',
      header: copy.colCredits,
      cell: (t) => {
        const d = draftOf(t);
        const error = errors[t.key];
        return (
          <div className="flex w-28 flex-col gap-1">
            <Input
              inputMode="decimal"
              autoComplete="off"
              aria-label={fill(copy.creditsLabel, { name: t.name })}
              invalid={Boolean(error)}
              className="h-8 text-right font-mono"
              value={d.credits}
              onChange={(e) => patch(t, { credits: e.target.value })}
            />
            {error && (
              <span role="alert" className="text-xs text-danger">
                {error}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'margin',
      header: copy.colMargin,
      cell: (t) => {
        const d = draftOf(t);
        const margin = marginPct(parseCredits(d.credits), t.providerCostMicrosPerUnit);
        if (margin === null) return <span className="text-muted">{copy.notCharged}</span>;
        return (
          <span className="flex items-center gap-2 font-mono">
            {Math.round(margin)}%
            {isLowMargin(margin) && <Badge tone="warn">⚠ {copy.lowMargin}</Badge>}
          </span>
        );
      },
    },
    {
      key: 'enabled',
      header: copy.colEnabled,
      cell: (t) => (
        <Switch
          label={fill(copy.enabledLabel, { name: t.name })}
          checked={draftOf(t).enabled}
          onCheckedChange={(enabled) => patch(t, { enabled })}
        />
      ),
    },
    {
      key: 'configured',
      header: copy.colConfigured,
      cell: (t) =>
        t.configured ? (
          <span className="text-accent">{copy.keySet}</span>
        ) : (
          <Badge tone="warn">{copy.notConfigured}</Badge>
        ),
    },
    {
      key: 'health',
      header: copy.colHealth,
      cell: (t) => (
        <span className="font-mono" title={t.health.lastError ?? undefined}>
          {formatHealth(t.health.calls24h, t.health.errorRate24h)}
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-8 md:px-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">{copy.title}</h1>
        <Button variant="primary" loading={saving} onClick={() => void onSave()}>
          {copy.save}
        </Button>
      </div>
      <p className="m-0 text-sm text-muted">{copy.intro}</p>
      {status === 'saved' && <Banner>{copy.saved}</Banner>}
      {status === 'nothing' && <Banner>{copy.nothing}</Banner>}
      {status === 'failed' && <Banner tone="warn">{copy.saveFailed}</Banner>}
      {tools.isPending && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading tools">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )}
      {tools.isError && <ErrorState title={copy.loadFailed} onRetry={() => void tools.refetch()} />}
      {tools.isSuccess && (
        <Table
          caption={copy.caption}
          columns={columns}
          rows={tools.data.items}
          rowKey={(t) => t.key}
          emptyTitle={copy.emptyTitle}
          emptyDescription={copy.emptyHint}
        />
      )}
      <p className="m-0 text-xs text-faint">{copy.footnote}</p>
    </div>
  );
}
