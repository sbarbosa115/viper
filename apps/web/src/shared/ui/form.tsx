import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from './cx';
import { Icon } from './icon';

const control =
  'w-full rounded-control border bg-surface px-3 text-sm text-fg placeholder:text-faint focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50';

function border(invalid?: boolean) {
  return invalid ? 'border-danger' : 'border-line-control';
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid ? true : undefined}
      className={cx(control, border(invalid), 'h-10', className)}
      {...rest}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid ? true : undefined}
      className={cx(control, border(invalid), 'py-2.5', className)}
      {...rest}
    />
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid ? true : undefined}
      className={cx(control, border(invalid), 'h-10', className)}
      {...rest}
    >
      {children}
    </select>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <label
      htmlFor={inputId}
      className={cx('inline-flex min-h-10 items-center gap-2.5 text-sm text-fg-2', className)}
    >
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        className="size-[18px] rounded-tag border border-line-control bg-surface accent-accent"
        {...rest}
      />
      {label}
    </label>
  );
});

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Switch({ checked, onCheckedChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cx(
        'relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50',
        checked ? 'border-accent bg-accent' : 'border-line-control bg-raised',
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'absolute top-0.5 size-4 rounded-full transition-all',
          checked ? 'left-[22px] bg-accent-ink' : 'left-0.5 bg-muted',
        )}
      />
    </button>
  );
}

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  invalid: boolean;
}

export interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  /** Render the control with the generated id, aria-describedby and invalid flag. */
  children: (props: FieldControlProps) => ReactNode;
}

/** Label + control + hint + error, linked with `for` and `aria-describedby`. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-fg">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy || undefined, invalid: Boolean(error) })}
      {hint && (
        <p id={hintId} className="m-0 text-xs text-faint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="m-0 flex items-center gap-1.5 text-xs text-danger">
          <Icon name="x" size={12} />
          {error}
        </p>
      )}
    </div>
  );
}
