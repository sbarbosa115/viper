import type { KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { t, type StringKey } from '../../../shared/i18n';
import { cx } from '../../../shared/ui';
import { TABS, type FinanceParams, type Tab } from '../lib/params';

const labels: Record<Tab, StringKey> = {
  pnl: 'finance.tab.pnl',
  expenses: 'finance.tab.expenses',
  invoices: 'finance.tab.invoices',
};

export const tabId = (tab: Tab) => `finance-tab-${tab}`;
export const panelId = (tab: Tab) => `finance-panel-${tab}`;

/** Tablist whose tabs are links (?tab=), with arrow-key movement; scrolls sideways on mobile. */
export function FinanceTabs({ params }: { params: FinanceParams }) {
  const navigate = useNavigate();

  function onKeyDown(event: KeyboardEvent, index: number) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const target = TABS[(index + step + TABS.length) % TABS.length]!;
    void navigate(params.hrefFor(target), { replace: true });
    requestAnimationFrame(() => document.getElementById(tabId(target))?.focus());
  }

  return (
    <div
      role="tablist"
      aria-label={t('finance.tabs')}
      className="flex gap-1 overflow-x-auto border-b border-line"
    >
      {TABS.map((tab, index) => {
        const selected = tab === params.tab;
        return (
          <Link
            key={tab}
            id={tabId(tab)}
            role="tab"
            to={params.hrefFor(tab)}
            replace
            aria-selected={selected}
            aria-controls={panelId(tab)}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cx(
              'inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-4 text-sm font-medium md:min-h-10',
              selected ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {t(labels[tab])}
          </Link>
        );
      })}
    </div>
  );
}
