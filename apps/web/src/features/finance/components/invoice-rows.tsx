import type { Month, ProviderRow } from '@app/contracts/finance';
import { Link } from 'react-router';
import { t } from '../../../shared/i18n';
import { Button, Input, cx } from '../../../shared/ui';
import { formatGap, formatMoney, monthLabel } from '../lib/format';
import { useInvoiceEditor, type InvoiceEditor } from './invoice-editor';

const sourceLabel = {
  invoice: 'finance.inv.source.invoice',
  plan: 'finance.inv.source.plan',
  estimate: 'finance.inv.source.estimate',
} as const;

export function SourceTag({ source }: { source: ProviderRow['counted']['source'] }) {
  return (
    <span className="rounded-tag bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">
      {t(sourceLabel[source])}
    </span>
  );
}

/** The gap column: +34.9%, "45% of plan used", or a dash. A flag adds the word and an icon. */
function gapText(row: ProviderRow): string {
  if (row.gapPct !== null) return formatGap(row.gapPct);
  if (row.planUsedPct !== null) return t('finance.inv.planUsed', { pct: row.planUsedPct });
  return '—';
}

/** Warning triangle; decorative, the visible "Gap:" word carries the meaning. */
function WarningIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M12 3.5 2.5 20h19L12 3.5ZM12 10v4.5M12 17.5v.01" />
    </svg>
  );
}

export function FlagNote({ row }: { row: ProviderRow }) {
  if (!row.flagged) return null;
  const text =
    row.gapPct !== null
      ? t('finance.inv.flagText', { provider: row.provider.name, pct: formatGap(row.gapPct) })
      : t('finance.inv.flagTextNoMeter', {
          provider: row.provider.name,
          amount: formatMoney(row.invoice?.amount.cents ?? 0),
        });
  return (
    <p className="m-0 flex items-center gap-1.5 text-xs text-warn">
      <WarningIcon />
      <span>
        <strong className="font-semibold">{t('finance.inv.flagWord')}:</strong> {text}
      </span>
    </p>
  );
}

function EditForm({
  row,
  month,
  editor,
}: {
  row: ProviderRow;
  month: Month;
  editor: InvoiceEditor;
}) {
  const label = t('finance.inv.amountFor', {
    provider: row.provider.name,
    month: monthLabel(month),
  });
  return (
    <div className="flex flex-col items-end gap-1.5">
      <Input
        aria-label={label}
        inputMode="decimal"
        autoComplete="off"
        placeholder={t('finance.inv.amountPlaceholder')}
        value={editor.amount}
        invalid={editor.error !== null}
        onChange={(e) => editor.setAmount(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') editor.submit();
          if (e.key === 'Escape' && editor.editing) editor.cancel();
        }}
        className="h-11 w-32 text-right font-mono md:h-9"
      />
      {editor.editing && (
        <Input
          aria-label={t('finance.inv.noteFor', { provider: row.provider.name })}
          placeholder={t('finance.inv.notePlaceholder')}
          value={editor.note}
          maxLength={200}
          onChange={(e) => editor.setNote(e.target.value)}
          className="h-11 w-48 md:h-9"
        />
      )}
      {editor.error && (
        <p role="alert" className="m-0 text-xs text-danger">
          {editor.error}
        </p>
      )}
    </div>
  );
}

function Actions({
  row,
  month,
  editor,
}: {
  row: ProviderRow;
  month: Month;
  editor: InvoiceEditor;
}) {
  const name = row.provider.name;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {editor.open ? (
        <>
          <Button
            size="sm"
            variant="primary"
            aria-label={t('finance.inv.saveFor', { provider: name })}
            loading={editor.saving}
            onClick={editor.submit}
            className="min-h-11 md:min-h-8"
          >
            {t('finance.inv.save')}
          </Button>
          {editor.editing && (
            <Button
              size="sm"
              variant="ghost"
              onClick={editor.cancel}
              className="min-h-11 md:min-h-8"
            >
              {t('finance.inv.cancel')}
            </Button>
          )}
          {editor.editing && row.invoice && (
            <Button
              size="sm"
              variant="danger-text"
              aria-label={t('finance.inv.removeFor', { provider: name })}
              loading={editor.removing}
              onClick={editor.discard}
              className="min-h-11 md:min-h-8"
            >
              {t('finance.inv.remove')}
            </Button>
          )}
        </>
      ) : (
        <Button
          size="sm"
          aria-label={t(row.invoice ? 'finance.inv.editFor' : 'finance.inv.enterFor', {
            provider: name,
          })}
          onClick={editor.start}
          className="min-h-11 md:min-h-8"
        >
          {t(row.invoice ? 'finance.inv.edit' : 'finance.inv.enter')}
        </Button>
      )}
      {row.flagged && (
        <Link to="/staff/tools" className="text-sm text-accent underline underline-offset-2">
          {t('finance.inv.review')}
        </Link>
      )}
      {row.plan && !row.flagged && (
        <Link
          to={`?tab=expenses&month=${month}`}
          className="text-sm text-accent underline underline-offset-2"
        >
          {t('finance.inv.planBill')}
        </Link>
      )}
    </div>
  );
}

export interface RowProps {
  row: ProviderRow;
  month: Month;
}

/** One provider as a desktop table row (InvDesktopAfter). */
export function InvoiceTableRow({ row, month }: RowProps) {
  const editor = useInvoiceEditor(row, month);
  return (
    <tr className={cx('border-b border-line last:border-b-0', row.flagged && 'bg-warn/5')}>
      <th scope="row" className="px-4 py-3 text-left font-normal text-fg">
        <span className="flex flex-col gap-1">
          {row.provider.name}
          <FlagNote row={row} />
        </span>
      </th>
      <td className="px-4 py-3 text-right font-mono">{formatMoney(row.metered.cents)}</td>
      <td className="px-4 py-3 text-right font-mono">
        {editor.open ? (
          <EditForm row={row} month={month} editor={editor} />
        ) : (
          formatMoney((row.invoice ?? row.plan)?.amount.cents ?? 0)
        )}
      </td>
      <td className="px-4 py-3 text-right font-mono text-muted">{gapText(row)}</td>
      <td className="px-4 py-3 text-right font-mono">
        <span className="inline-flex items-center gap-2">
          {formatMoney(row.counted.amount.cents)}
          <SourceTag source={row.counted.source} />
        </span>
      </td>
      <td className="px-4 py-3">
        <Actions row={row} month={month} editor={editor} />
      </td>
    </tr>
  );
}

/** One provider as a mobile card (InvMobileAfter). */
export function InvoiceCard({ row, month }: RowProps) {
  const editor = useInvoiceEditor(row, month);
  return (
    <li
      className={cx(
        'flex flex-col gap-2 rounded-row border border-line-strong bg-surface p-4',
        row.flagged && 'border-warn/40 bg-warn/5',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-fg">{row.provider.name}</span>
        <span className="flex items-center gap-2 font-mono text-fg">
          {formatMoney(row.counted.amount.cents)}
          <SourceTag source={row.counted.source} />
        </span>
      </div>
      <div className="flex justify-between text-sm text-muted">
        <span>{t('finance.inv.metered')}</span>
        <span className="font-mono">
          {formatMoney(row.metered.cents)}
          {row.gapPct === null &&
            row.planUsedPct !== null &&
            ` · ${t('finance.inv.planUsedShort', { pct: row.planUsedPct })}`}
        </span>
      </div>
      {row.gapPct !== null && (
        <div className="flex justify-between text-sm text-muted">
          <span>{t('finance.inv.gap')}</span>
          <span className="font-mono">{formatGap(row.gapPct)}</span>
        </div>
      )}
      <FlagNote row={row} />
      {editor.open && (
        <div className="flex flex-col items-stretch gap-2">
          <EditForm row={row} month={month} editor={editor} />
        </div>
      )}
      <Actions row={row} month={month} editor={editor} />
    </li>
  );
}
