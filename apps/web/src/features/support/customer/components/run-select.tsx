import type { RunRef } from '@app/contracts/support';
import type { ChangeEventHandler, FocusEventHandler, Ref } from 'react';
import { Field, Select } from '../../../../shared/ui';
import { copy, fill } from '../../copy';
import { formatDateTime } from '../lib/format';

export interface RunSelectProps {
  runs: RunRef[] | undefined;
  loading: boolean;
  failed: boolean;
  disabled: boolean;
  error: string | undefined;
  value: string;
  name: string;
  onChange: ChangeEventHandler<HTMLSelectElement>;
  onBlur: FocusEventHandler<HTMLSelectElement>;
  selectRef: Ref<HTMLSelectElement>;
}

const runLabel = (run: RunRef) =>
  fill(copy.runOption, {
    plan: run.planName,
    when: formatDateTime(run.startedAt),
    status: run.status.toUpperCase(),
  });

/** "Which run? (optional)": the Business's runs of the last 90 days, newest first. */
export function RunSelect(props: RunSelectProps) {
  const empty = !props.loading && !props.failed && props.runs?.length === 0;
  return (
    <Field
      label={copy.run}
      hint={props.failed ? copy.runLoadFailed : copy.runHint}
      error={props.error}
    >
      {(p) => (
        <Select
          {...p}
          name={props.name}
          ref={props.selectRef}
          value={props.value}
          onChange={props.onChange}
          onBlur={props.onBlur}
          disabled={props.disabled || props.loading || empty}
        >
          <option value="">{empty ? copy.runEmpty : copy.runNone}</option>
          {props.runs?.map((run) => (
            <option key={run.id} value={run.id}>
              {runLabel(run)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
