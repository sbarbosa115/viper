import type { HTMLAttributes, ReactNode } from 'react';
import { t } from '../i18n';
import { cx } from './cx';
import { Icon } from './icon';

export interface SpinnerProps {
  size?: number;
  /** Accessible label; pass "" when the spinner sits inside a labelled control. */
  label?: string;
}

/** Thin ring with a lime arc. */
export function Spinner({ size = 24, label = t('common.loading') }: SpinnerProps) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className="inline-block"
    >
      <span
        className="viper-spin block rounded-full border-2 border-line-control border-t-accent"
        style={{ width: size, height: size }}
      />
    </span>
  );
}

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cx('viper-pulse rounded-sm bg-raised', className)}
      {...rest}
    />
  );
}

export interface BannerProps {
  tone?: 'info' | 'warn';
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}

export function Banner({ tone = 'info', title, children, action }: BannerProps) {
  return (
    <div
      role={tone === 'warn' ? 'alert' : 'status'}
      className={cx(
        'flex items-start gap-3 rounded-row border px-4 py-3 text-sm',
        tone === 'warn'
          ? 'border-warn/40 bg-warn/10 text-fg-2'
          : 'border-accent-line bg-accent-tint-weak text-fg-2',
      )}
    >
      <span className={cx('mt-0.5 shrink-0', tone === 'warn' ? 'text-warn' : 'text-accent')}>
        <Icon name={tone === 'warn' ? 'x' : 'check'} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        {title && <p className="m-0 font-semibold text-fg">{title}</p>}
        <div>{children}</div>
      </div>
      {action}
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  headingLevel?: 1 | 2 | 3;
}

export function EmptyState({ title, description, action, headingLevel = 2 }: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <Heading className="m-0 text-xl font-semibold tracking-tight text-fg">{title}</Heading>
      {description && <p className="m-0 text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({
  title = t('error.title'),
  description = t('error.body'),
  onRetry,
  retryLabel = t('error.retry'),
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center"
    >
      <h2 className="m-0 text-xl font-semibold tracking-tight text-fg">{title}</h2>
      <p className="m-0 text-sm text-muted">{description}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex h-10 items-center gap-2 rounded-control border border-line-control px-4 text-sm font-medium text-fg hover:bg-surface"
        >
          <Icon name="retry" size={16} />
          {retryLabel}
        </button>
      )}
    </div>
  );
}
