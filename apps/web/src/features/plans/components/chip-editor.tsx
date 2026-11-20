import { useState } from 'react';
import { Button, Chip, Input } from '../../../shared/ui';
import { copy } from '../copy';

export interface ChipEditorProps {
  label: string;
  addLabel: string;
  values: string[];
  max: number;
  error?: string | undefined;
  onChange: (values: string[]) => void;
}

/** Chips with a remove button each and a small box to add one (Fit signals, exclusions). */
export function ChipEditor({ label, addLabel, values, max, error, onChange }: ChipEditorProps) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const text = draft.trim().slice(0, 80);
    if (text && !values.includes(text) && values.length < max) onChange([...values, text]);
    setDraft('');
  };
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        {values.map((v) => (
          <Chip key={v} onRemove={() => onChange(values.filter((x) => x !== v))}>
            {v}
          </Chip>
        ))}
        {values.length < max && (
          <span className="inline-flex items-center gap-1">
            <Input
              aria-label={addLabel}
              value={draft}
              maxLength={80}
              className="h-8 w-44"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <Button size="sm" aria-label={`${copy.add}: ${addLabel}`} onClick={add}>
              {copy.add}
            </Button>
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="m-0 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
