import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './icon';
import { Spinner } from './feedback';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger-text';
export type ButtonSize = 'sm' | 'md' | 'lg';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover font-semibold',
  secondary: 'border border-line-control bg-transparent text-fg hover:bg-surface font-medium',
  ghost: 'bg-transparent text-muted hover:text-fg hover:bg-surface font-medium',
  'danger-text': 'bg-transparent text-danger hover:bg-surface font-medium',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-sm',
  md: 'h-10 px-4 text-sm rounded-control',
  lg: 'h-12 px-5 text-[15px] rounded-row',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Optional shortcut hint shown inside the button, such as ⌘↵. */
  hint?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    hint,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner size={16} label="" />}
      {children}
      {hint && <span className="font-mono text-[11px] opacity-70">{hint}</span>}
    </button>
  );
});

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> {
  /** Required: icon-only buttons need an accessible name (also shown as the tooltip). */
  'aria-label': string;
  icon: IconName;
  variant?: 'ghost' | 'secondary';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, variant = 'ghost', className, type = 'button', 'aria-label': label, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-grid size-10 place-items-center rounded-control text-muted transition-colors hover:bg-surface hover:text-fg disabled:opacity-50',
        variant === 'secondary' && 'border border-line-control',
        className,
      )}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
});
