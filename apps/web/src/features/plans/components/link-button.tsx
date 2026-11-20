import { Link, type LinkProps } from 'react-router';
import { cx } from '../../../shared/ui';

/** A link that looks like a kit Button (the kit has no link variant). */
export function LinkButton({
  variant = 'secondary',
  className,
  ...rest
}: LinkProps & { variant?: 'primary' | 'secondary' }) {
  return (
    <Link
      className={cx(
        'inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-control px-4 text-sm',
        variant === 'primary'
          ? 'bg-accent font-semibold text-accent-ink hover:bg-accent-hover'
          : 'border border-line-control font-medium text-fg hover:bg-surface',
        className,
      )}
      {...rest}
    />
  );
}
