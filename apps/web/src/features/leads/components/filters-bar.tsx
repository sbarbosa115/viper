import type { RunSummary } from '@app/contracts/research';
import { useEffect, useState } from 'react';
import { Chip, Input, Select } from '../../../shared/ui';
import { copy, fill } from '../copy';
import type { FilterValues } from '../lib/filters';
import { formatDate } from '../lib/format';

const feedbackChips = [
  { value: undefined, label: copy.feedbackAll },
  { value: 'good', label: copy.feedbackGood },
  { value: 'not_fit', label: copy.feedbackNotFit },
  { value: 'none', label: copy.feedbackNone },
] as const;

const scores = [40, 50, 60, 70, 80, 90];

const label = 'text-xs font-semibold uppercase tracking-[0.08em] text-muted';

function SearchBox({ q, onChange }: { q: string; onChange: (q: string | undefined) => void }) {
  const [text, setText] = useState(q);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (text.trim() !== q) onChange(text.trim() || undefined);
    }, 250);
    return () => clearTimeout(timer);
    // Only typing starts the timer; `q` and `onChange` are read when it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  // The URL changed from outside (Clear): follow it, unless it is just our own typing coming back.
  const [seenQ, setSeenQ] = useState(q);
  if (q !== seenQ) {
    setSeenQ(q);
    if (text.trim() !== q) setText(q);
  }
  return (
    <div className="flex min-w-48 flex-1 flex-col gap-1">
      <label htmlFor="lead-search" className={label}>
        {copy.search}
      </label>
      <Input
        id="lead-search"
        type="search"
        placeholder={copy.searchPlaceholder}
        maxLength={120}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </div>
  );
}

export interface FiltersBarProps {
  filters: FilterValues;
  runs: RunSummary[];
  onChange: (patch: FilterValues) => void;
}

/** Run, min Fit score, Feedback, search by name and sort (FR-26). */
export function FiltersBar({ filters, runs, onChange }: FiltersBarProps) {
  return (
    <div
      role="search"
      aria-label={copy.filters}
      className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-line px-4 py-3"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="lead-run" className={label}>
          {copy.run}
        </label>
        <Select
          id="lead-run"
          value={filters.runId ?? ''}
          onChange={(event) => onChange({ runId: event.target.value || undefined })}
        >
          <option value="">{copy.allRuns}</option>
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {fill(copy.runOption, {
                date: formatDate(run.startedAt ?? run.finishedAt ?? new Date(0).toISOString()),
                leads: `${run.leadsDelivered} leads`,
              })}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="lead-min-score" className={label}>
          {copy.minScore}
        </label>
        <Select
          id="lead-min-score"
          value={filters.minScore === undefined ? '' : String(filters.minScore)}
          onChange={(event) =>
            onChange({ minScore: event.target.value ? Number(event.target.value) : undefined })
          }
        >
          <option value="">{copy.anyScore}</option>
          {scores.map((s) => (
            <option key={s} value={s}>
              {s}+
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <span id="lead-feedback-label" className={label}>
          {copy.feedback}
        </span>
        <div role="group" aria-labelledby="lead-feedback-label" className="flex flex-wrap gap-1.5">
          {feedbackChips.map((chip) => (
            <Chip
              key={chip.label}
              selected={filters.feedback === chip.value}
              onSelectedChange={() => onChange({ feedback: chip.value })}
            >
              {chip.label}
            </Chip>
          ))}
        </div>
      </div>
      <SearchBox q={filters.q ?? ''} onChange={(q) => onChange({ q })} />
      <div className="flex flex-col gap-1">
        <label htmlFor="lead-sort" className={label}>
          {copy.sort}
        </label>
        <Select
          id="lead-sort"
          value={filters.sort ?? 'score'}
          onChange={(event) => onChange({ sort: event.target.value as FilterValues['sort'] })}
        >
          <option value="score">{copy.sortScore}</option>
          <option value="distance">{copy.sortDistance}</option>
          <option value="newest">{copy.sortNewest}</option>
        </Select>
      </div>
    </div>
  );
}
