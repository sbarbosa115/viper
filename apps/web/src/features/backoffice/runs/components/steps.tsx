import type { StaffRunDetail, StaffToolCall } from '@app/contracts/research';
import { useState } from 'react';
import { Button, Table, type Column } from '../../../../shared/ui';
import { copy, fill } from '../copy';
import {
  formatClock,
  formatDuration,
  formatMillicredits,
  formatTokens,
  formatUsd,
} from '../lib/format';

type Step = StaffRunDetail['steps'][number];

/** "1", or "1 → 2" when the step ran across attempts. */
function attemptsOf(step: Step): string {
  const ns = step.toolCalls.map((c) => c.attempt).filter((n): n is number => n !== null);
  if (ns.length === 0) return copy.none;
  const lo = Math.min(...ns);
  const hi = Math.max(...ns);
  return lo === hi ? String(lo) : `${lo} → ${hi}`;
}

const kb = (bytes: number | null) =>
  bytes === null ? copy.none : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const callColumns: Column<StaffToolCall>[] = [
  {
    key: 'tool',
    header: copy.colTool,
    cell: (c) => <code className="font-mono text-[13px]">{c.toolKey}</code>,
  },
  { key: 'attempt', header: copy.colAttempt, numeric: true, cell: (c) => c.attempt ?? copy.none },
  { key: 'units', header: copy.colUnits, numeric: true, cell: (c) => formatTokens(c.units) },
  {
    key: 'credits',
    header: copy.colCredits,
    numeric: true,
    cell: (c) => (c.reused ? '0' : formatMillicredits(c.millicredits)),
  },
  {
    key: 'cost',
    header: copy.colProvider,
    numeric: true,
    cell: (c) => formatUsd(c.providerCostMicros, 4),
  },
  {
    key: 'status',
    header: copy.colCallStatus,
    cell: (c) =>
      c.reused ? (
        <span className="text-accent">{copy.reused}</span>
      ) : c.status === 'ok' ? (
        copy.callOk
      ) : c.status === 'error' ? (
        <span className="text-danger">
          {copy.callError}
          {c.error && ` · ${c.error}`}
        </span>
      ) : (
        copy.callSkipped
      ),
  },
  {
    key: 'duration',
    header: copy.colCallDuration,
    numeric: true,
    cell: (c) => `${(c.durationMs / 1000).toFixed(1)} s`,
  },
  { key: 'time', header: copy.colTime, numeric: true, cell: (c) => formatClock(c.createdAt) },
];

function ToolCalls({ step }: { step: Step }) {
  const reused = step.toolCalls.filter((c) => c.reused).length;
  return (
    <section aria-label={fill(copy.toolCalls, { step: step.name })} className="flex flex-col gap-2">
      <h3 className="m-0 text-base font-semibold text-fg">
        {fill(copy.toolCalls, { step: step.name })}
      </h3>
      {reused > 0 && (
        <p className="m-0 font-mono text-xs text-accent">
          {fill(copy.reusedSummary, { n: reused })}
        </p>
      )}
      <Table
        caption={fill(copy.callsCaption, { step: step.name })}
        columns={callColumns}
        rows={step.toolCalls}
        rowKey={(c) => c.id}
        emptyTitle={copy.noCalls}
      />
    </section>
  );
}

const statusText = (s: Step) =>
  s.error ? `${copy.stepStatus[s.status]} · ${s.error}` : copy.stepStatus[s.status];

/** FR-32: Steps with status, attempt, duration, credits and Checkpoint size; Tool calls expand under. */
export function Steps({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const columns: Column<Step>[] = [
    { key: 'n', header: copy.colNumber, numeric: true, cell: (s) => steps.indexOf(s) + 1 },
    {
      key: 'step',
      header: copy.colStep,
      cell: (s) => <span className="font-medium text-fg">{s.name}</span>,
    },
    { key: 'attempt', header: copy.colAttempt, numeric: true, cell: attemptsOf },
    { key: 'status', header: copy.colStepStatus, cell: statusText },
    {
      key: 'duration',
      header: copy.colCallDuration,
      numeric: true,
      cell: (s) => formatDuration(s.durationS),
    },
    {
      key: 'credits',
      header: copy.colCredits,
      numeric: true,
      cell: (s) => s.creditsSpent.toFixed(1),
    },
    {
      key: 'checkpoint',
      header: copy.colCheckpoint,
      numeric: true,
      cell: (s) => kb(s.checkpointBytes),
    },
    {
      key: 'calls',
      header: copy.colCalls,
      cell: (s) => {
        const expanded = open.has(s.key);
        return (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={expanded}
            aria-label={
              expanded
                ? fill(copy.hideCalls, { step: s.name })
                : fill(copy.showCalls, { n: s.toolCalls.length, step: s.name })
            }
            onClick={() => toggle(s.key)}
          >
            {expanded ? '▾' : '▸'} {s.toolCalls.length}
          </Button>
        );
      },
    },
  ];

  return (
    <section aria-label={copy.steps} className="flex flex-col gap-3">
      <h2 className="m-0 text-lg font-semibold text-fg">{copy.steps}</h2>
      <Table caption={copy.stepsCaption} columns={columns} rows={steps} rowKey={(s) => s.key} />
      {steps
        .filter((s) => open.has(s.key))
        .map((s) => (
          <ToolCalls key={s.key} step={s} />
        ))}
    </section>
  );
}
