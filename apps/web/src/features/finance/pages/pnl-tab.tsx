import { categoryLabels, type Pnl } from '@app/contracts/finance';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { t } from '../../../shared/i18n';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Skeleton,
  cx,
} from '../../../shared/ui';
import { usePnl } from '../api/hooks';
import { BudgetDialog } from '../components/budget-dialog';
import { MonthSelect } from '../components/month-select';
import { PnlChart } from '../components/pnl-chart';
import { formatMoney, formatPct, monthLabel } from '../lib/format';
import type { FinanceParams } from '../lib/params';

const sourceNote = {
  providers: 'finance.pnl.sourceProviders',
  stripe_fees: 'finance.pnl.sourceStripe',
  bills: 'finance.pnl.sourceBills',
} as const;

export function PnlTab({ params }: { params: FinanceParams }) {
  const { month, current } = params;
  const pnl = usePnl(month);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <MonthSelect
          month={month}
          current={current}
          onChange={(m) => params.setSearch((next) => next.set('month', m))}
        />
        {pnl.data?.monthToDate && <Badge tone="accent">{t('finance.monthToDate')}</Badge>}
        <a
          href={`/api/staff/finance/pnl.csv?from=${month}&to=${month}`}
          download
          className="ml-auto inline-flex h-11 items-center gap-2 rounded-control bg-fg px-4 text-sm font-semibold text-bg hover:opacity-90 md:h-10"
        >
          <Icon name="download" size={16} />
          {t('finance.exportCsv')}
        </a>
      </div>
      {pnl.isPending && <PnlSkeleton />}
      {pnl.isError && (
        <ErrorState
          title={t('finance.loadFailed')}
          description={t('finance.loadFailedBody')}
          onRetry={() => void pnl.refetch()}
          retryLabel={t('finance.retry')}
        />
      )}
      {pnl.isSuccess && <PnlBody pnl={pnl.data} />}
    </div>
  );
}

function PnlSkeleton() {
  return (
    <div role="status" aria-label={t('finance.loading')} className="flex flex-col gap-4">
      <Skeleton className="h-16" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-48" />
      <Skeleton className="h-64" />
    </div>
  );
}

const isEmpty = (pnl: Pnl) =>
  pnl.revenue.sales.cents === 0 && pnl.revenue.refunds.cents === 0 && pnl.totalExpenses.cents === 0;

function PnlBody({ pnl }: { pnl: Pnl }) {
  if (isEmpty(pnl)) {
    return (
      <div className="flex flex-col gap-5">
        <BudgetPanel pnl={pnl} />
        <EmptyState
          headingLevel={2}
          title={t('finance.pnl.empty', { month: monthLabel(pnl.month) })}
          description={t('finance.pnl.emptyHint')}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <BudgetPanel pnl={pnl} />
      {pnl.providerFlags > 0 && (
        <p className="m-0 text-sm text-fg-2">
          {pnl.providerFlags === 1
            ? t('finance.pnl.flagsOne')
            : t('finance.pnl.flags', { count: pnl.providerFlags })}{' '}
          <Link
            to={`?tab=invoices&month=${pnl.month}`}
            className="text-accent underline underline-offset-2"
          >
            {t('finance.pnl.flagsLink')}
          </Link>
        </p>
      )}
      <Summary pnl={pnl} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[3fr_2fr]">
        <Card className="flex flex-col gap-3">
          <h2 className="m-0 text-lg font-semibold text-fg">{t('finance.pnl.chart')}</h2>
          <PnlChart trend={pnl.trend} />
        </Card>
        <Categories pnl={pnl} />
      </div>
      {pnl.yearlyThisMonth.length > 0 && <Yearly pnl={pnl} />}
      <Statement pnl={pnl} />
    </div>
  );
}

function BudgetPanel({ pnl }: { pnl: Pnl }) {
  const [editing, setEditing] = useState(false);
  const { budget } = pnl;
  const vars = {
    spent: formatMoney(budget.spent.cents),
    budget: formatMoney(budget.amount.cents),
    pct: budget.pct ?? 0,
  };
  const alerts = budget.alertsSent.map((n) => `${n}%`).join(' and ');
  const barWidth = Math.min(100, budget.pct ?? (budget.spent.cents > 0 ? 100 : 0));
  const statusKey = `finance.pnl.budgetStatus.${budget.status}` as const;

  return (
    <Card className="flex flex-col gap-3">
      {budget.status !== 'under' && (
        <Banner
          tone="warn"
          action={
            <Button size="sm" onClick={() => setEditing(true)} className="min-h-11 md:min-h-8">
              {t('finance.pnl.editBudget')}
            </Button>
          }
        >
          <strong className="font-semibold text-fg">
            {budget.status === 'over'
              ? budget.pct === null
                ? t('finance.pnl.overZero', vars)
                : t('finance.pnl.over', vars)
              : t('finance.pnl.near', vars)}
          </strong>
          {alerts && (
            <span className="block text-muted">
              {t('finance.pnl.alerts', { thresholds: alerts })}
            </span>
          )}
        </Banner>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-mono text-fg">{t('finance.pnl.budgetLine', vars)}</span>
        <span className="flex items-center gap-3">
          <Badge tone={budget.status === 'under' ? 'accent' : 'warn'}>{t(statusKey)}</Badge>
          {budget.status === 'under' && (
            <Button size="sm" onClick={() => setEditing(true)} className="min-h-11 md:min-h-8">
              {t('finance.pnl.editBudget')}
            </Button>
          )}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t('finance.pnl.budgetBar')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, budget.pct ?? 0)}
        aria-valuetext={budget.pct === null ? t('finance.pnl.budgetLine', vars) : `${budget.pct}%`}
        className="h-1.5 overflow-hidden rounded-full bg-line"
      >
        <div
          className={cx('h-full rounded-full', budget.status === 'under' ? 'bg-accent' : 'bg-warn')}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      {editing && (
        <BudgetDialog open currentCents={budget.amount.cents} onClose={() => setEditing(false)} />
      )}
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub: ReactNode }) {
  return (
    <Card className="flex flex-col gap-1.5 !p-4">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="font-mono text-2xl font-semibold text-fg">{value}</span>
      <span className="text-xs text-faint">{sub}</span>
    </Card>
  );
}

function Summary({ pnl }: { pnl: Pnl }) {
  const net = pnl.netProfit.cents;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat
        label={t('finance.pnl.revenue')}
        value={formatMoney(pnl.revenue.net.cents)}
        sub={
          pnl.revenue.salesCount === 1
            ? t('finance.pnl.revenueSubOne')
            : t('finance.pnl.revenueSub', { count: pnl.revenue.salesCount })
        }
      />
      <Stat
        label={t('finance.pnl.expenses')}
        value={formatMoney(pnl.totalExpenses.cents)}
        sub={t('finance.pnl.expensesSub')}
      />
      <Stat
        label={t('finance.pnl.net')}
        value={formatMoney(net)}
        sub={net < 0 ? t('finance.pnl.netBurn') : t('finance.pnl.netProfit')}
      />
      <Stat
        label={t('finance.pnl.runRate')}
        value={
          <>
            {formatMoney(pnl.fixedRunRate.cents)}
            <span className="text-sm font-normal text-muted"> {t('finance.pnl.perMonth')}</span>
          </>
        }
        sub={t('finance.pnl.runRateSub')}
      />
    </div>
  );
}

function Categories({ pnl }: { pnl: Pnl }) {
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="m-0 text-lg font-semibold text-fg">{t('finance.pnl.categories')}</h2>
      <table
        aria-label={t('finance.pnl.categoriesLabel')}
        className="w-full border-collapse text-sm"
      >
        <tbody>
          {pnl.categories.map((c) => (
            <tr key={c.category} className="border-b border-line last:border-b-0">
              <th scope="row" className="py-2 text-left font-normal text-fg-2">
                {categoryLabels[c.category]}
              </th>
              <td className="py-2 text-right font-mono text-fg">{formatMoney(c.amount.cents)}</td>
              <td className="w-14 py-2 text-right font-mono text-muted">
                {Math.round(c.sharePct)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Yearly({ pnl }: { pnl: Pnl }) {
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="m-0 text-lg font-semibold text-fg">{t('finance.pnl.yearly')}</h2>
      <ul className="m-0 flex list-none flex-col p-0">
        {pnl.yearlyThisMonth.map((y) => (
          <li
            key={y.expenseId}
            className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-2 text-sm last:border-b-0"
          >
            <span className="text-fg-2">{y.name}</span>
            <span className="font-mono text-fg">
              {formatMoney(y.amount.cents)}{' '}
              <span className="text-xs text-muted">
                {t('finance.pnl.yearlyEquivalent', {
                  amount: formatMoney(y.monthlyEquivalent.cents),
                })}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Row({
  label,
  note,
  amount,
  tone,
}: {
  label: ReactNode;
  note?: string;
  amount: string;
  tone?: 'total';
}) {
  return (
    <tr
      className={cx(
        'border-b border-line',
        tone === 'total' && 'border-line-control font-semibold text-fg',
      )}
    >
      <th
        scope="row"
        className={cx(
          'py-2.5 text-left font-normal',
          tone === 'total' ? 'font-semibold text-fg' : 'pl-4 text-fg-2',
        )}
      >
        {label}
        {note && <span className="ml-2 font-mono text-[11px] font-normal text-faint">{note}</span>}
      </th>
      <td className="py-2.5 text-right font-mono">{amount}</td>
    </tr>
  );
}

function Section({ title }: { title: string }) {
  return (
    <tr>
      <th
        scope="colgroup"
        colSpan={2}
        className="pb-1 pt-5 text-left font-mono text-xs font-medium uppercase tracking-wider text-muted"
      >
        {title}
      </th>
    </tr>
  );
}

function Statement({ pnl }: { pnl: Pnl }) {
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="m-0 text-lg font-semibold text-fg">
        {t('finance.pnl.statement', { month: monthLabel(pnl.month) })}
      </h2>
      <table
        aria-label={t('finance.pnl.statementLabel')}
        className="w-full border-collapse text-sm"
      >
        <tbody>
          <Section title={t('finance.pnl.sectionRevenue')} />
          <Row label={t('finance.pnl.sales')} amount={formatMoney(pnl.revenue.sales.cents)} />
          <Row label={t('finance.pnl.refunds')} amount={formatMoney(-pnl.revenue.refunds.cents)} />
          <Section title={t('finance.pnl.sectionCost')} />
          {pnl.costOfRevenue.lines.map((line) => (
            <Row
              key={`${line.category}-${line.source}`}
              label={line.source === 'stripe_fees' ? t('finance.pnl.stripeFees') : line.label}
              note={t(sourceNote[line.source])}
              amount={formatMoney(line.amount.cents)}
            />
          ))}
          <Row
            tone="total"
            label={t('finance.pnl.gross')}
            note={
              pnl.grossMarginPct === null
                ? t('finance.pnl.marginNone')
                : t('finance.pnl.margin', { pct: formatPct(pnl.grossMarginPct) })
            }
            amount={formatMoney(pnl.grossProfit.cents)}
          />
          <Section title={t('finance.pnl.sectionOperating')} />
          {pnl.operating.lines.map((line) => (
            <Row
              key={line.category}
              label={categoryLabels[line.category]}
              amount={formatMoney(line.amount.cents)}
            />
          ))}
          <Row
            tone="total"
            label={t('finance.pnl.net')}
            amount={formatMoney(pnl.netProfit.cents)}
          />
        </tbody>
      </table>
    </Card>
  );
}
