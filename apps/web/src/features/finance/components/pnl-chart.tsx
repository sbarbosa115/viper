import type { Pnl } from '@app/contracts/finance';
import { t } from '../../../shared/i18n';
import { formatMoney, monthLabel, shortMonth } from '../lib/format';

type Trend = Pnl['trend'];

const W = 640;
const H = 200;
const LEFT = 8;
const TOP = 12;
const BOTTOM = 26;

/**
 * Revenue vs expenses bars with the net as a line, inline SVG from tokens (no chart library).
 * Months before the history start are null: drawn as a dash and listed as "No data". The same
 * numbers are in a visually hidden table, which is the text alternative.
 */
export function PnlChart({ trend }: { trend: Trend }) {
  const values = trend.flatMap((m) => [
    m.revenue?.cents ?? 0,
    m.expenses?.cents ?? 0,
    m.net?.cents ?? 0,
  ]);
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const plotH = H - TOP - BOTTOM;
  const y = (cents: number) => TOP + ((max - cents) / (max - min)) * plotH;
  const zero = y(0);
  const slot = (W - LEFT) / trend.length;
  const bar = slot * 0.3;

  const netPoints = trend
    .map((m, i) => (m.net ? `${LEFT + i * slot + slot / 2},${y(m.net.cents)}` : null))
    .filter((p): p is string => p !== null)
    .join(' ');
  const hasGap = trend.some((m) => m.revenue === null);

  return (
    <figure className="m-0 flex flex-col gap-2">
      <svg
        role="img"
        aria-label={t('finance.pnl.chartLabel')}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
      >
        <line x1={LEFT} y1={zero} x2={W} y2={zero} className="stroke-line-strong" />
        {trend.map((m, i) => {
          const cx = LEFT + i * slot + slot / 2;
          const label = shortMonth(m.month);
          return (
            <g key={m.month}>
              {m.revenue && m.expenses ? (
                <>
                  <rect
                    x={cx - bar - 1}
                    y={Math.min(y(m.revenue.cents), zero)}
                    width={bar}
                    height={Math.abs(zero - y(m.revenue.cents))}
                    rx={2}
                    className="fill-accent"
                  >
                    <title>{`${monthLabel(m.month)}: revenue ${formatMoney(m.revenue.cents)}`}</title>
                  </rect>
                  <rect
                    x={cx + 1}
                    y={Math.min(y(m.expenses.cents), zero)}
                    width={bar}
                    height={Math.abs(zero - y(m.expenses.cents))}
                    rx={2}
                    className="fill-muted"
                  >
                    <title>{`${monthLabel(m.month)}: expenses ${formatMoney(m.expenses.cents)}`}</title>
                  </rect>
                </>
              ) : (
                <line x1={cx - 5} y1={zero} x2={cx + 5} y2={zero} className="stroke-faint">
                  <title>{`${monthLabel(m.month)}: ${t('finance.noData')}`}</title>
                </line>
              )}
              <text
                x={cx}
                y={H - 8}
                textAnchor="middle"
                className="fill-muted font-mono text-[10px]"
              >
                {label}
              </text>
            </g>
          );
        })}
        {netPoints.includes(' ') && (
          <polyline
            points={netPoints}
            fill="none"
            strokeWidth={1.8}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray="5 3"
            className="stroke-fg"
          />
        )}
      </svg>
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-tag bg-accent" />
          {t('finance.pnl.legendRevenue')}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-tag bg-muted" />
          {t('finance.pnl.legendExpenses')}
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-0 w-4 border-t-2 border-dashed border-fg"
          />
          {t('finance.pnl.legendNet')}
        </li>
      </ul>
      {hasGap && (
        <figcaption className="text-xs text-faint">{t('finance.pnl.chartNote')}</figcaption>
      )}
      <table className="sr-only">
        <caption>{t('finance.pnl.chartTable')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('finance.pnl.colMonth')}</th>
            <th scope="col">{t('finance.pnl.legendRevenue')}</th>
            <th scope="col">{t('finance.pnl.legendExpenses')}</th>
            <th scope="col">{t('finance.pnl.legendNet')}</th>
          </tr>
        </thead>
        <tbody>
          {trend.map((m) => (
            <tr key={m.month}>
              <th scope="row">{monthLabel(m.month)}</th>
              <td>{m.revenue ? formatMoney(m.revenue.cents) : t('finance.noData')}</td>
              <td>{m.expenses ? formatMoney(m.expenses.cents) : t('finance.noData')}</td>
              <td>{m.net ? formatMoney(m.net.cents) : t('finance.noData')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
