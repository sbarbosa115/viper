import {
  CATEGORIES,
  categoryLabels,
  category as categorySchema,
  type Expense,
} from '@app/contracts/finance';
import { useState } from 'react';
import { t } from '../../../shared/i18n';
import { Button, Checkbox, EmptyState, ErrorState, Select, Skeleton, cx } from '../../../shared/ui';
import { useExpenses } from '../api/hooks';
import { ExpenseCreate } from '../components/expense-create';
import { ExpenseEdit } from '../components/expense-edit';
import { ExpenseList } from '../components/expense-list';
import { MonthSelect } from '../components/month-select';
import { formatMoney, monthLabel } from '../lib/format';
import type { FinanceParams } from '../lib/params';

type Kind = 'all' | 'recurring' | 'one_off';
type PanelState = { mode: 'add' } | { mode: 'edit'; id: string } | null;

export function ExpensesTab({ params }: { params: FinanceParams }) {
  const { month, current, search } = params;
  const rawKind = search.get('kind');
  const kind: Kind = rawKind === 'recurring' || rawKind === 'one_off' ? rawKind : 'all';
  const parsedCategory = categorySchema.safeParse(search.get('category'));
  const category = parsedCategory.success ? parsedCategory.data : null;
  const includeEnded = search.get('ended') === '1';

  const expenses = useExpenses(month, { category, includeEnded });
  const [panel, setPanel] = useState<PanelState>(null);

  const all = expenses.data?.items ?? [];
  const counts = {
    all: all.length,
    recurring: all.filter((e) => e.kind === 'recurring').length,
    one_off: all.filter((e) => e.kind === 'one_off').length,
  };
  const shown = kind === 'all' ? all : all.filter((e) => e.kind === kind);
  const editing: Expense | undefined =
    panel?.mode === 'edit' ? all.find((e) => e.id === panel.id) : undefined;
  const filtered = category !== null || kind !== 'all' || includeEnded;
  const emptyUnfiltered = expenses.isSuccess && all.length === 0 && !filtered;

  const setParam = (key: string, value: string | null) =>
    params.setSearch((next) => (value === null ? next.delete(key) : next.set(key, value)));

  const kindChips: { id: Kind; label: string }[] = [
    { id: 'all', label: t('finance.exp.kindAll', { n: counts.all }) },
    { id: 'recurring', label: t('finance.exp.kindRecurring', { n: counts.recurring }) },
    { id: 'one_off', label: t('finance.exp.kindOneOff', { n: counts.one_off }) },
  ];

  const addButton = (
    <Button
      variant="primary"
      onClick={() => setPanel({ mode: 'add' })}
      className="min-h-11 md:min-h-10"
    >
      {t('finance.exp.add')}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <MonthSelect month={month} current={current} onChange={(m) => setParam('month', m)} />
        {!emptyUnfiltered && <div className="ml-auto">{addButton}</div>}
      </div>
      {expenses.isPending && (
        <div role="status" aria-label={t('finance.loading')} className="flex flex-col gap-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      )}
      {expenses.isError && (
        <ErrorState
          title={t('finance.loadFailed')}
          description={t('finance.loadFailedBody')}
          onRetry={() => void expenses.refetch()}
          retryLabel={t('finance.retry')}
        />
      )}
      {emptyUnfiltered && (
        <EmptyState
          title={t('finance.exp.empty')}
          description={t('finance.exp.emptyHint')}
          action={addButton}
        />
      )}
      {expenses.isSuccess && (all.length > 0 || filtered) && (
        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label={t('finance.exp.filterKind')}
                className="flex flex-wrap gap-2"
              >
                {kindChips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    aria-pressed={kind === chip.id}
                    onClick={() => setParam('kind', chip.id === 'all' ? null : chip.id)}
                    className={cx(
                      'min-h-11 rounded-sm border px-3 text-[13px] md:min-h-8',
                      kind === chip.id
                        ? 'border-line-control bg-raised text-fg'
                        : 'border-line-strong text-muted hover:text-fg',
                    )}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
              <Select
                aria-label={t('finance.exp.category')}
                value={category ?? ''}
                onChange={(e) => setParam('category', e.target.value || null)}
                className="h-11 w-auto md:h-9"
              >
                <option value="">{t('finance.exp.allCategories')}</option>
                {CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {categoryLabels[c.key]}
                  </option>
                ))}
              </Select>
              <Checkbox
                label={t('finance.exp.showEnded')}
                checked={includeEnded}
                onChange={(e) => setParam('ended', e.target.checked ? '1' : null)}
                className="min-h-11 md:min-h-10"
              />
            </div>
            <p className="m-0 font-mono text-xs text-muted">
              {t('finance.exp.totals', {
                runRate: formatMoney(expenses.data.totals.fixedRunRate.cents),
                month: monthLabel(month),
                charged: formatMoney(expenses.data.totals.chargesInMonth.cents),
              })}
            </p>
            <ExpenseList
              items={shown}
              selectedId={editing?.id ?? null}
              onOpen={(id) => setPanel({ mode: 'edit', id })}
              emptyTitle={t('finance.exp.emptyFiltered')}
              emptyDescription={t('finance.exp.emptyFilteredHint')}
            />
            <p className="m-0 text-xs text-faint">{t('finance.exp.auto')}</p>
          </div>
          {panel?.mode === 'add' && <ExpenseCreate onClose={() => setPanel(null)} />}
          {editing && (
            <ExpenseEdit
              key={`${editing.id}-${editing.updatedAt}`}
              expense={editing}
              onClose={() => setPanel(null)}
            />
          )}
        </div>
      )}
      {emptyUnfiltered && panel?.mode === 'add' && <ExpenseCreate onClose={() => setPanel(null)} />}
    </div>
  );
}
