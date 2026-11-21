import type { ReactNode } from 'react';
import { t } from '../../../shared/i18n';
import { IconButton } from '../../../shared/ui';

export interface PanelProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Add / edit panel: a full-screen form on mobile, a side drawer next to the list on desktop. Same
 * markup for both; only the classes change at the md breakpoint.
 */
export function Panel({ title, onClose, children }: PanelProps) {
  return (
    <aside
      aria-label={title}
      className="fixed inset-0 z-40 flex flex-col gap-4 overflow-y-auto bg-bg p-4 md:static md:z-auto md:rounded-card md:border md:border-line-strong md:bg-sunken md:p-5"
    >
      <div className="flex items-center gap-2">
        <IconButton
          aria-label={t('finance.form.back')}
          icon="chevron"
          onClick={onClose}
          className="size-11 -scale-x-100 md:hidden"
        />
        <h2 className="m-0 flex-1 text-lg font-semibold text-fg">{title}</h2>
        <IconButton
          aria-label={t('finance.close')}
          icon="x"
          onClick={onClose}
          className="hidden md:grid"
        />
      </div>
      {children}
    </aside>
  );
}
