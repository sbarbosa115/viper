import { categoryLabels, type Expense } from '@app/contracts/finance';
import { t } from '../../../shared/i18n';
import { Badge, Table, cx, type Column } from '../../../shared/ui';
import { formatDate, formatDay, formatMoney } from '../lib/format';
import { useIsMobile } from '../lib/use-is-mobile';

export interface ExpenseListProps {
  items: Expense[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  emptyTitle: string;
  emptyDescription: string;
}

const billed = (e: Expense) =>
  e.kind === 'one_off'
    ? t('finance.exp.oneOff')
    : e.cadence === 'yearly'
      ? t('finance.exp.yearly')
      : t('finance.exp.monthly');

function Status({ expense }: { expense: Expense }) {
  if (expense.status === 'ended') return <Badge>{t('finance.exp.statusEnded')}</Badge>;
  if (expense.status === 'ending' && expense.endsOn)
    return (
      <Badge tone="warn">
        {t('finance.exp.statusEnding', { date: formatDay(expense.endsOn) })}
      </Badge>
    );
  return null;
}

const covers = (e: Expense) =>
  e.coversProvider ? t('finance.exp.covers', { provider: e.coversProvider.name }) : null;

/** FR-1: a table on desktop, tappable cards on mobile. */
export function ExpenseList(props: ExpenseListProps) {
  return useIsMobile() ? <Cards {...props} /> : <DesktopTable {...props} />;
}

function DesktopTable({
  items,
  selectedId,
  onOpen,
  emptyTitle,
  emptyDescription,
}: ExpenseListProps) {
  const columns: Column<Expense>[] = [
    {
      key: 'name',
      header: t('finance.exp.colName'),
      cell: (e) => (
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label={t('finance.exp.open', { name: e.name })}
              aria-current={selectedId === e.id ? 'true' : undefined}
              onClick={() => onOpen(e.id)}
              className="rounded-tag text-left font-medium text-fg underline-offset-2 hover:underline"
            >
              {e.name}
            </button>
            {covers(e) && (
              <span className="rounded-tag bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">
                {covers(e)}
              </span>
            )}
            <Status expense={e} />
          </span>
          <span className="text-xs text-faint">{e.vendor}</span>
        </div>
      ),
    },
    {
      key: 'category',
      header: t('finance.exp.colCategory'),
      cell: (e) => categoryLabels[e.category],
    },
    {
      key: 'amount',
      header: t('finance.exp.colAmount'),
      numeric: true,
      cell: (e) => formatMoney(e.amount.cents),
    },
    { key: 'billed', header: t('finance.exp.colBilled'), cell: billed },
    {
      key: 'next',
      header: t('finance.exp.colNext'),
      cell: (e) =>
        e.kind === 'one_off'
          ? t('finance.exp.paid', { date: formatDate(e.startsOn) })
          : e.nextChargeOn
            ? formatDate(e.nextChargeOn)
            : t('finance.exp.noNext'),
    },
  ];
  return (
    <Table
      caption={t('finance.exp.list')}
      columns={columns}
      rows={items}
      rowKey={(e) => e.id}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
    />
  );
}

function Cards({ items, selectedId, onOpen }: ExpenseListProps) {
  return (
    <ul aria-label={t('finance.exp.listCards')} className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((e) => (
        <li key={e.id}>
          <button
            type="button"
            aria-label={t('finance.exp.open', { name: e.name })}
            aria-current={selectedId === e.id ? 'true' : undefined}
            onClick={() => onOpen(e.id)}
            className={cx(
              'flex min-h-14 w-full items-center justify-between gap-3 rounded-row border border-line-strong bg-surface px-4 py-3 text-left',
              selectedId === e.id && 'border-accent-line',
            )}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium text-fg">{e.name}</span>
              <span className="text-xs text-muted">
                {[
                  categoryLabels[e.category],
                  covers(e),
                  e.kind === 'one_off'
                    ? t('finance.exp.paidMobile', { date: formatDay(e.startsOn) })
                    : e.nextChargeOn
                      ? t('finance.exp.nextMobile', { date: formatDate(e.nextChargeOn) })
                      : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <Status expense={e} />
            </span>
            <span className="flex shrink-0 flex-col items-end">
              <span className="font-mono text-fg">{formatMoney(e.amount.cents)}</span>
              <span className="text-xs text-muted">{billed(e).toLowerCase()}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
