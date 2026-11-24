import { t } from '../../../shared/i18n';
import { FinanceTabs, panelId, tabId } from '../components/finance-tabs';
import { useFinanceParams } from '../lib/params';
import { ExpensesTab } from './expenses-tab';
import { InvoicesTab } from './invoices-tab';
import { PnlTab } from './pnl-tab';

/** Staff → Expenses: P&L, Expenses and Provider invoices (prd-expenses FR-1..FR-11). */
export function ExpensesPage() {
  const params = useFinanceParams();
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 md:px-7 md:py-8">
      <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">{t('finance.title')}</h1>
      <FinanceTabs params={params} />
      <div role="tabpanel" id={panelId(params.tab)} aria-labelledby={tabId(params.tab)}>
        {params.tab === 'pnl' && <PnlTab params={params} />}
        {params.tab === 'expenses' && <ExpensesTab params={params} />}
        {params.tab === 'invoices' && <InvoicesTab params={params} />}
      </div>
    </div>
  );
}
