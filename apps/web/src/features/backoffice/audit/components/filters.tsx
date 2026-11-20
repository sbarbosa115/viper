import type { AuditLogEntry } from '@app/contracts/platform';
import { useMemo, useState } from 'react';
import { Button, Field, Input, Select } from '../../../../shared/ui';
import { noFilters, type AuditFilters } from '../api/hooks';
import { copy } from '../copy';

export interface FiltersProps {
  value: AuditFilters;
  onChange: (value: AuditFilters) => void;
  /** Entries seen so far; they supply the Business, Staff and Action choices. */
  entries: AuditLogEntry[];
}

function choices(entries: AuditLogEntry[]) {
  const businesses = new Map<string, string>();
  const staff = new Map<string, string>();
  const actions = new Set<string>();
  for (const e of entries) {
    if (e.business) businesses.set(e.business.id, e.business.name);
    staff.set(e.staff.id, e.staff.email);
    actions.add(e.action);
  }
  const byLabel = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1]);
  return {
    businesses: [...businesses].sort(byLabel),
    staff: [...staff].sort(byLabel),
    actions: [...actions].sort(),
  };
}

/** Business, Staff and Action filters (FR-7); changes apply at once. */
export function Filters({ value, onChange, entries }: FiltersProps) {
  const options = useMemo(() => choices(entries), [entries]);
  // The Action is typed, so it applies on Enter or when the field loses focus.
  const [draft, setDraft] = useState(value.action);
  const applyAction = () => {
    const action = draft.trim();
    if (action !== value.action) onChange({ ...value, action });
  };
  const active = value.businessId || value.staffMemberId || value.action;
  return (
    <form
      role="search"
      aria-label={copy.filters}
      onSubmit={(e) => {
        e.preventDefault();
        applyAction();
      }}
      className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <Field label={copy.business}>
        {(p) => (
          <Select
            {...p}
            value={value.businessId}
            onChange={(e) => onChange({ ...value, businessId: e.target.value })}
          >
            <option value="">{copy.allBusinesses}</option>
            {options.businesses.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={copy.staff}>
        {(p) => (
          <Select
            {...p}
            value={value.staffMemberId}
            onChange={(e) => onChange({ ...value, staffMemberId: e.target.value })}
          >
            <option value="">{copy.allStaff}</option>
            {options.staff.map(([id, email]) => (
              <option key={id} value={id}>
                {email}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={copy.action} hint={copy.actionHint}>
        {(p) => (
          <>
            <Input
              {...p}
              list="audit-actions"
              autoComplete="off"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={applyAction}
            />
            <datalist id="audit-actions" aria-label={copy.actionList}>
              {options.actions.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      {active && (
        <Button
          variant="ghost"
          className="self-start sm:mt-[26px]"
          onClick={() => {
            setDraft('');
            onChange(noFilters);
          }}
        >
          {copy.clear}
        </Button>
      )}
    </form>
  );
}
