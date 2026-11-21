import type { ProviderRow } from '@app/contracts/finance';
import { t } from '../../../shared/i18n';
import { Banner, EmptyState, ErrorState, Skeleton } from '../../../shared/ui';
import { useProviderInvoices } from '../api/hooks';
import { InvoiceCard, InvoiceTableRow } from '../components/invoice-rows';
import { MonthSelect } from '../components/month-select';
import { formatMoney, monthLabel } from '../lib/format';
import type { FinanceParams } from '../lib/params';
import { useIsMobile } from '../lib/use-is-mobile';

export function InvoicesTab({ params }: { params: FinanceParams }) {
  const { month, current } = params;
  const invoices = useProviderInvoices(month);
  const mobile = useIsMobile();
  const label = monthLabel(month);

  return (
    <div className="flex flex-col gap-4">
      <MonthSelect
        month={month}
        current={current}
        onChange={(m) => params.setSearch((next) => next.set('month', m))}
      />
      <p className="m-0 max-w-3xl text-sm text-muted">{t('finance.inv.intro')}</p>
      {invoices.isPending && (
        <div role="status" aria-label={t('finance.loading')} className="flex flex-col gap-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      )}
      {invoices.isError && (
        <ErrorState
          title={t('finance.loadFailed')}
          description={t('finance.loadFailedBody')}
          onRetry={() => void invoices.refetch()}
          retryLabel={t('finance.retry')}
        />
      )}
      {invoices.isSuccess && invoices.data.rows.length === 0 && (
        <EmptyState
          title={t('finance.inv.empty', { month: label })}
          description={t('finance.inv.emptyHint')}
        />
      )}
      {invoices.isSuccess && invoices.data.rows.length > 0 && (
        <>
          {invoices.data.flaggedCount > 0 && (
            <Banner tone="warn" title={flaggedTitle(invoices.data.flaggedCount)}>
              {t('finance.inv.bannerBody')}
            </Banner>
          )}
          {mobile ? (
            <Cards
              rows={invoices.data.rows}
              month={month}
              label={label}
              counted={invoices.data.totals.counted.cents}
            />
          ) : (
            <DesktopTable
              rows={invoices.data.rows}
              month={month}
              label={label}
              metered={invoices.data.totals.metered.cents}
              counted={invoices.data.totals.counted.cents}
            />
          )}
        </>
      )}
    </div>
  );
}

const flaggedTitle = (n: number) =>
  n === 1 ? t('finance.inv.bannerOne') : t('finance.inv.banner', { n });

interface ListProps {
  rows: ProviderRow[];
  month: string;
  label: string;
  counted: number;
}

function DesktopTable({ rows, month, label, metered, counted }: ListProps & { metered: number }) {
  const heads = [
    ['finance.inv.colProvider', false],
    ['finance.inv.colMetered', true],
    ['finance.inv.colInvoice', true],
    ['finance.inv.colGap', true],
    ['finance.inv.colCounts', true],
    ['finance.inv.colActions', false],
  ] as const;
  return (
    <div
      role="region"
      aria-label={t('finance.inv.table', { month: label })}
      tabIndex={0}
      className="max-w-full overflow-x-auto rounded-card border border-line-strong"
    >
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{t('finance.inv.table', { month: label })}</caption>
        <thead>
          <tr className="border-b border-line">
            {heads.map(([key, numeric]) => (
              <th
                key={key}
                scope="col"
                className={`px-4 py-3 text-xs font-medium text-muted ${numeric ? 'text-right' : ''}`}
              >
                {t(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <InvoiceTableRow key={row.provider.key} row={row} month={month} />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line-control font-semibold text-fg">
            <th scope="row" className="px-4 py-3 text-left">
              {t('finance.inv.total')}
            </th>
            <td className="px-4 py-3 text-right font-mono">{formatMoney(metered)}</td>
            <td />
            <td />
            <td className="px-4 py-3 text-right font-mono">{formatMoney(counted)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Cards({ rows, month, label, counted }: ListProps) {
  return (
    <div className="flex flex-col gap-3">
      <ul
        aria-label={t('finance.inv.cards', { month: label })}
        className="m-0 flex list-none flex-col gap-3 p-0"
      >
        {rows.map((row) => (
          <InvoiceCard key={row.provider.key} row={row} month={month} />
        ))}
      </ul>
      <p className="m-0 flex justify-between text-sm font-semibold text-fg">
        <span>{t('finance.inv.totalCounts')}</span>
        <span className="font-mono">{formatMoney(counted)}</span>
      </p>
    </div>
  );
}
