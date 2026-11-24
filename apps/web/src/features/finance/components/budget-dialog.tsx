import { saveBudgetBody } from '@app/contracts/finance';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../../shared/api/client';
import { t } from '../../../shared/i18n';
import { Banner, Button, Dialog, Field, Input } from '../../../shared/ui';
import { useSaveBudget } from '../api/hooks';
import { centsToDollars, dollarsToCents } from '../lib/format';

export interface BudgetDialogProps {
  open: boolean;
  currentCents: number;
  onClose: () => void;
}

/** FR-11: change the platform-wide monthly Budget (0..$100,000). */
export function BudgetDialog({ open, currentCents, onClose }: BudgetDialogProps) {
  const save = useSaveBudget();
  const [text, setText] = useState(centsToDollars(currentCents));
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const parsed = saveBudgetBody.safeParse({ monthlyBudgetCents: dollarsToCents(text) });
    if (!parsed.success) {
      setError(t('finance.amountFormat'));
      return;
    }
    setError(null);
    save.mutate(parsed.data.monthlyBudgetCents, {
      onSuccess: onClose,
      onError: (e) => {
        if (e instanceof ApiError && e.fields?.monthlyBudgetCents) {
          setError(e.fields.monthlyBudgetCents);
        } else {
          setFailed(true);
        }
      },
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('finance.pnl.budgetDialog')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('finance.cancel')}
          </Button>
          <Button type="submit" form="budget-form" variant="primary" loading={save.isPending}>
            {t('finance.pnl.budgetSave')}
          </Button>
        </>
      }
    >
      <form id="budget-form" noValidate onSubmit={submit} className="flex flex-col gap-3">
        <Field
          label={t('finance.pnl.budgetField')}
          hint={t('finance.pnl.budgetHint')}
          error={error}
        >
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </Field>
        {failed && <Banner tone="warn">{t('finance.pnl.budgetFailed')}</Banner>}
      </form>
    </Dialog>
  );
}
