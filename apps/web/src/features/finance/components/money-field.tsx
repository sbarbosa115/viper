import { useState } from 'react';
import { useController, type Control, type FieldValues, type Path } from 'react-hook-form';
import { Field, Input } from '../../../shared/ui';
import { centsToDollars, dollarsToCents } from '../lib/format';

export interface MoneyFieldProps<T extends FieldValues, Out> {
  control: Control<T, unknown, Out>;
  name: Path<T>;
  label: string;
  hint?: string;
}

/** A dollars text box that keeps integer cents (or undefined / NaN while invalid) in the form. */
export function MoneyField<T extends FieldValues, Out>({
  control,
  name,
  label,
  hint,
}: MoneyFieldProps<T, Out>) {
  const { field, fieldState } = useController({ control, name });
  const initial = typeof field.value === 'number' ? centsToDollars(field.value) : '';
  const [text, setText] = useState(initial);
  return (
    <Field label={label} hint={hint} error={fieldState.error?.message}>
      {(p) => (
        <Input
          {...p}
          inputMode="decimal"
          autoComplete="off"
          name={field.name}
          ref={field.ref}
          value={text}
          onBlur={field.onBlur}
          onChange={(e) => {
            setText(e.target.value);
            field.onChange(
              e.target.value.trim() === '' ? undefined : dollarsToCents(e.target.value),
            );
          }}
        />
      )}
    </Field>
  );
}
