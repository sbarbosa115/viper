import { HISTORY_START_MONTH, month as monthSchema, type Month } from '@app/contracts/finance';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { currentMonth } from './format';

export const TABS = ['pnl', 'expenses', 'invoices'] as const;
export type Tab = (typeof TABS)[number];

const isTab = (value: string | null): value is Tab => TABS.some((tab) => tab === value);

/** The month from ?month=, falling back to the current month when missing or out of range. */
export function resolveMonth(raw: string | null, current: Month): Month {
  const parsed = monthSchema.safeParse(raw);
  if (!parsed.success || parsed.data < HISTORY_START_MONTH || parsed.data > current) return current;
  return parsed.data;
}

export interface FinanceParams {
  tab: Tab;
  month: Month;
  current: Month;
  search: URLSearchParams;
  setSearch: (update: (next: URLSearchParams) => void) => void;
  hrefFor: (tab: Tab) => string;
}

/** ?tab=pnl|expenses|invoices (default pnl) and ?month=YYYY-MM (default the current month). */
export function useFinanceParams(): FinanceParams {
  const [search, setParams] = useSearchParams();
  const current = useMemo(() => currentMonth(), []);
  const rawTab = search.get('tab');
  const tab: Tab = isTab(rawTab) ? rawTab : 'pnl';
  const month = resolveMonth(search.get('month'), current);
  return {
    tab,
    month,
    current,
    search,
    setSearch: (update) => {
      const next = new URLSearchParams(search);
      update(next);
      setParams(next, { replace: true });
    },
    hrefFor: (target) => {
      const next = new URLSearchParams({ tab: target });
      if (search.get('month')) next.set('month', month);
      return `?${next.toString()}`;
    },
  };
}
