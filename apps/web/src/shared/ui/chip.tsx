import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { t } from '../i18n';
import { cx } from './cx';
import { Icon } from './icon';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** "filter" chips are 32px; "choice" chips (chat answers, targets) are 40px. */
  kind?: 'filter' | 'choice';
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  /** Shows a remove button; the label is announced as "Remove <chip text>". */
  onRemove?: () => void;
  removeLabel?: string;
  children: ReactNode;
}

export function Chip({
  kind = 'filter',
  selected = false,
  onSelectedChange,
  onRemove,
  removeLabel,
  className,
  children,
  ...rest
}: ChipProps) {
  const base = cx(
    'inline-flex items-center gap-1.5 border text-sm transition-colors',
    kind === 'filter' ? 'h-8 rounded-sm px-3' : 'h-10 rounded-control px-4',
    selected
      ? kind === 'choice'
        ? 'border-accent bg-accent-tint text-accent'
        : 'border-line-strong bg-raised text-fg'
      : kind === 'choice'
        ? 'border-line-control text-fg-2 hover:bg-surface'
        : 'border-line-strong text-muted hover:text-fg',
    className,
  );
  const selectable = onSelectedChange !== undefined;
  const label = typeof children === 'string' ? children : '';
  return (
    <span className={cx('inline-flex items-center', onRemove && 'gap-0.5')}>
      <button
        type="button"
        aria-pressed={selectable ? selected : undefined}
        onClick={selectable ? () => onSelectedChange(!selected) : undefined}
        className={base}
        {...rest}
      >
        {selected && kind === 'choice' && <Icon name="check" size={14} />}
        {children}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel ?? `${t('common.remove')} ${label}`.trim()}
          className="grid size-8 place-items-center rounded-sm text-muted hover:text-fg"
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </span>
  );
}
