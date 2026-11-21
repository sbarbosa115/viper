import { saveInvoiceBody, type Month, type ProviderRow } from '@app/contracts/finance';
import { useState } from 'react';
import { ApiError } from '../../../shared/api/client';
import { t } from '../../../shared/i18n';
import { useDeleteInvoice, useSaveInvoice } from '../api/hooks';
import { centsToDollars, dollarsToCents } from '../lib/format';

/** Draft state and actions for one provider row's invoice (FR-8), shared by table and cards. */
export function useInvoiceEditor(row: ProviderRow, month: Month) {
  const save = useSaveInvoice(month);
  const remove = useDeleteInvoice(month);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const hasInvoice = row.invoice !== null;
  /** Rows with no invoice always show the entry box; rows with one show it while editing. */
  const open = editing || !hasInvoice;

  const start = () => {
    setAmount(row.invoice ? centsToDollars(row.invoice.amount.cents) : '');
    setNote(row.invoice?.note ?? '');
    setError(null);
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setAmount('');
    setNote('');
    setError(null);
  };

  const submit = () => {
    const parsed = saveInvoiceBody.safeParse({
      amountCents: dollarsToCents(amount),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!parsed.success) {
      setError(t('finance.amountFormat'));
      return;
    }
    setError(null);
    save.mutate(
      { provider: row.provider.key, body: parsed.data },
      {
        onSuccess: cancel,
        onError: (e) =>
          setError(
            e instanceof ApiError && (e.fields?.amountCents || e.fields?.note)
              ? (e.fields.amountCents ?? e.fields.note ?? t('finance.inv.failed'))
              : t('finance.inv.failed'),
          ),
      },
    );
  };

  const discard = () => {
    setError(null);
    remove.mutate(row.provider.key, {
      onSuccess: cancel,
      onError: () => setError(t('finance.inv.removeFailed')),
    });
  };

  return {
    open,
    editing,
    amount,
    note,
    error,
    saving: save.isPending,
    removing: remove.isPending,
    setAmount,
    setNote,
    start,
    cancel,
    submit,
    discard,
  };
}

export type InvoiceEditor = ReturnType<typeof useInvoiceEditor>;
