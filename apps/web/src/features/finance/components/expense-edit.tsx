import {
  addPriceBody,
  oneOffExpensePatch,
  recurringExpensePatch,
  type AddPriceBody,
  type Category,
  type Expense,
  type UpdateExpenseBody,
} from '@app/contracts/finance';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type KeyboardEvent } from 'react';
import { useForm, useWatch, type Resolver, type UseFormSetError } from 'react-hook-form';
import { ApiError } from '../../../shared/api/client';
import { t } from '../../../shared/i18n';
import { Banner, Button, Dialog, Field, Icon, Input, Select, Textarea } from '../../../shared/ui';
import {
  useAddPrice,
  useDeleteExpense,
  useDeletePrice,
  useProviders,
  useUpdateExpense,
} from '../api/hooks';
import { applyFieldErrors, isApiError, schemaOptions } from '../lib/form-errors';
import { formatDate, formatMoney } from '../lib/format';
import { canCoverProvider, CategoryOptions, CoversField } from './expense-fields';
import { MoneyField } from './money-field';
import { Panel } from './panel';

interface Values {
  name?: string;
  vendor?: string;
  category?: Category;
  amountCents?: number;
  spentOn?: string;
  coversProvider?: string | null;
  link?: string | null;
  notes?: string | null;
}

const fieldNames = [
  'name',
  'vendor',
  'category',
  'amountCents',
  'spentOn',
  'coversProvider',
  'link',
  'notes',
] as const;

/** Cleared text means "remove it" (null in a PATCH). */
const nullableText = {
  setValueAs: (v: string | null) => {
    const text = v?.trim() ?? '';
    return text === '' ? null : text;
  },
};

const isHttps = (url: string | null): url is string => url?.startsWith('https://') === true;

export interface ExpenseEditProps {
  expense: Expense;
  onClose: () => void;
}

/** FR-3 / FR-4: edit a bill or one-off, change its price from a date, stop it, or delete it. */
export function ExpenseEdit({ expense, onClose }: ExpenseEditProps) {
  const recurring = expense.kind === 'recurring';
  const update = useUpdateExpense();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const form = useForm<Values, unknown, UpdateExpenseBody>({
    resolver: zodResolver(
      recurring ? recurringExpensePatch : oneOffExpensePatch,
      schemaOptions,
    ) as unknown as Resolver<Values, unknown, UpdateExpenseBody>,
    defaultValues: {
      name: expense.name,
      vendor: expense.vendor,
      category: expense.category,
      link: expense.link,
      notes: expense.notes,
      ...(recurring
        ? { coversProvider: expense.coversProvider?.key ?? null }
        : { amountCents: expense.amount.cents, spentOn: expense.startsOn }),
    },
  });
  const { register, control, handleSubmit, setError, setValue, formState } = form;
  const { errors } = formState;
  const category = useWatch({ control, name: 'category' }) ?? expense.category;
  const coversAllowed = recurring && canCoverProvider(category);
  const providers = useProviders(coversAllowed);

  const onSubmit = (body: UpdateExpenseBody) => {
    setFormError(null);
    setSaved(false);
    const send = !coversAllowed && recurring ? { ...body, coversProvider: null } : body;
    update.mutate(
      { id: expense.id, body: send },
      {
        onSuccess: () => setSaved(true),
        onError: (error) => setFormError(updateErrorMessage(error, setError)),
      },
    );
  };

  return (
    <Panel title={t('finance.form.editTitle', { name: expense.name })} onClose={onClose}>
      <form
        noValidate
        aria-label={t('finance.form.editTitle', { name: expense.name })}
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        className="flex flex-col gap-4"
      >
        <Field label={t('finance.form.name')} error={errors.name?.message}>
          {(p) => <Input {...p} autoComplete="off" {...register('name')} />}
        </Field>
        <Field label={t('finance.form.vendor')} error={errors.vendor?.message}>
          {(p) => <Input {...p} autoComplete="off" {...register('vendor')} />}
        </Field>
        <Field label={t('finance.form.category')} error={errors.category?.message}>
          {(p) => (
            <Select
              {...p}
              {...register('category', {
                onChange: (e: { target: { value: Category } }) => {
                  if (!canCoverProvider(e.target.value)) setValue('coversProvider', null);
                },
              })}
            >
              <CategoryOptions />
            </Select>
          )}
        </Field>
        {coversAllowed && (
          <CoversField
            providers={providers.data?.items ?? []}
            category={category}
            error={errors.coversProvider?.message}
          >
            {({ options, ...p }) => (
              <Select {...p} {...register('coversProvider', nullableText)}>
                {options}
              </Select>
            )}
          </CoversField>
        )}
        {recurring ? (
          <dl className="m-0 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-[13px] text-muted">{t('finance.form.billed')}</dt>
              <dd className="m-0 text-fg">
                {expense.cadence === 'yearly' ? t('finance.exp.yearly') : t('finance.exp.monthly')}
              </dd>
            </div>
            <div>
              <dt className="text-[13px] text-muted">{t('finance.form.started')}</dt>
              <dd className="m-0 text-fg">{formatDate(expense.startsOn)}</dd>
            </div>
          </dl>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <MoneyField control={control} name="amountCents" label={t('finance.form.amount')} />
            <Field label={t('finance.form.spentOn')} error={errors.spentOn?.message}>
              {(p) => <Input {...p} type="date" min="2026-11-01" {...register('spentOn')} />}
            </Field>
          </div>
        )}
        {recurring && <PriceHistory expense={expense} />}
        <Field
          label={t('finance.form.link')}
          hint={t('finance.form.linkHint')}
          error={errors.link?.message}
        >
          {(p) => (
            <Input {...p} inputMode="url" autoComplete="off" {...register('link', nullableText)} />
          )}
        </Field>
        {isHttps(expense.link) && (
          <a
            href={expense.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-accent underline underline-offset-2"
          >
            {t('finance.link.open')}
            <Icon name="external" size={14} />
          </a>
        )}
        <Field label={t('finance.form.notes')} error={errors.notes?.message}>
          {(p) => <Textarea {...p} rows={2} {...register('notes', nullableText)} />}
        </Field>
        {formError && <Banner tone="warn">{formError}</Banner>}
        {saved && !formError && (
          <p role="status" className="m-0 flex items-center gap-1.5 text-sm text-accent">
            <Icon name="check" size={14} />
            {t('finance.saved')}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="submit"
            variant="primary"
            loading={update.isPending}
            className="min-h-11 md:min-h-10"
          >
            {t('finance.form.saveChanges')}
          </Button>
        </div>
      </form>
      <div className="flex flex-col gap-3 border-t border-line pt-4">
        {recurring && <StopBill expense={expense} />}
        <DeleteExpense expense={expense} onDeleted={onClose} />
      </div>
    </Panel>
  );
}

function updateErrorMessage(error: unknown, setError: UseFormSetError<Values>): string | null {
  if (isApiError(error, 409, 'PROVIDER_ALREADY_COVERED')) {
    const name = typeof error.details?.name === 'string' ? error.details.name : '';
    return t('finance.form.coveredBy', { name });
  }
  if (isApiError(error, 422, 'BEFORE_HISTORY_START')) return t('finance.form.beforeStart');
  if (isApiError(error, 422, 'COVERS_PROVIDER_CATEGORY')) return t('finance.form.coversCategory');
  if (isApiError(error, 404, 'UNKNOWN_PROVIDER')) return t('finance.form.unknownProvider');
  if (isApiError(error, 404)) return t('finance.form.gone');
  if (applyFieldErrors<Values>(error, fieldNames, setError)) return null;
  return t('finance.form.failed');
}

/** Price versions with the one-line "from" history, and the add-a-price-change row. */
function PriceHistory({ expense }: { expense: Expense }) {
  const add = useAddPrice();
  const remove = useDeletePrice();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ effectiveFrom?: string; amountCents?: number }, unknown, AddPriceBody>({
    resolver: zodResolver(addPriceBody, schemaOptions) as unknown as Resolver<
      { effectiveFrom?: string; amountCents?: number },
      unknown,
      AddPriceBody
    >,
    defaultValues: { effectiveFrom: '' },
  });
  const { register, control, handleSubmit, setError: setFieldError, reset, formState } = form;

  const submit = handleSubmit((body) => {
    setError(null);
    add.mutate(
      { id: expense.id, body },
      {
        onSuccess: () => reset({ effectiveFrom: '' }),
        onError: (e) => {
          if (isApiError(e, 422, 'EFFECTIVE_BEFORE_START'))
            setError(t('finance.price.beforeStart'));
          else if (!applyFieldErrors(e, ['effectiveFrom', 'amountCents'], setFieldError))
            setError(t('finance.price.failed'));
        },
      },
    );
  });

  // Enter in these inputs adds the price; it must not submit the surrounding edit form.
  const onEnter = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void submit();
  };

  return (
    <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
      <legend className="mb-1 text-[13px] font-medium text-fg">{t('finance.price.title')}</legend>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {expense.versions.map((v, index) => (
          <li
            key={v.effectiveFrom}
            className="flex items-center justify-between gap-2 text-sm text-fg-2"
          >
            <span className="font-mono">
              {t('finance.price.version', {
                amount: formatMoney(v.amount.cents),
                date: formatDate(v.effectiveFrom),
              })}
            </span>
            {index > 0 && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('finance.price.remove', { date: formatDate(v.effectiveFrom) })}
                disabled={remove.isPending}
                onClick={() => remove.mutate({ id: expense.id, effectiveFrom: v.effectiveFrom })}
                className="min-h-11 md:min-h-8"
              >
                <Icon name="x" size={14} />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {remove.isError && (
        <Banner tone="warn">
          {isApiError(remove.error, 409, 'FIRST_VERSION')
            ? t('finance.price.firstVersion')
            : t('finance.price.failed')}
        </Banner>
      )}
      <div className="grid grid-cols-2 gap-3" onKeyDown={onEnter}>
        <MoneyField control={control} name="amountCents" label={t('finance.price.amount')} />
        <Field label={t('finance.price.from')} error={formState.errors.effectiveFrom?.message}>
          {(p) => (
            <Input {...p} type="date" min={expense.startsOn} {...register('effectiveFrom')} />
          )}
        </Field>
      </div>
      <p className="m-0 text-xs text-faint">{t('finance.price.note')}</p>
      {error && <Banner tone="warn">{error}</Banner>}
      <div>
        <Button
          onClick={() => void submit()}
          loading={add.isPending}
          className="min-h-11 md:min-h-10"
        >
          {t('finance.price.add')}
        </Button>
      </div>
    </fieldset>
  );
}

/** End a bill on a date (FR-3 "End"), or resume one that has an end date. */
function StopBill({ expense }: { expense: Expense }) {
  const update = useUpdateExpense();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const send = (endsOn: string | null) => {
    setError(null);
    update.mutate(
      { id: expense.id, body: { endsOn } },
      {
        onSuccess: () => setOpen(false),
        onError: (e) =>
          setError(
            e instanceof ApiError
              ? (e.fields?.endsOn ?? t('finance.stop.failed'))
              : t('finance.stop.failed'),
          ),
      },
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {expense.endsOn !== null && (
        <Button
          onClick={() => send(null)}
          loading={update.isPending}
          className="min-h-11 self-start md:min-h-10"
        >
          {t('finance.stop.resume')}
        </Button>
      )}
      {expense.endsOn === null && !open && (
        <Button onClick={() => setOpen(true)} className="min-h-11 self-start md:min-h-10">
          {t('finance.stop.button')}
        </Button>
      )}
      {open && (
        <div className="flex flex-col gap-2">
          <Field label={t('finance.stop.date')}>
            {(p) => (
              <Input
                {...p}
                type="date"
                min={expense.startsOn}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            )}
          </Field>
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={date === ''}
              loading={update.isPending}
              onClick={() => send(date)}
              className="min-h-11 md:min-h-10"
            >
              {t('finance.stop.confirm')}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} className="min-h-11 md:min-h-10">
              {t('finance.cancel')}
            </Button>
          </div>
        </div>
      )}
      {error && <Banner tone="warn">{error}</Banner>}
    </div>
  );
}

function DeleteExpense({ expense, onDeleted }: { expense: Expense; onDeleted: () => void }) {
  const remove = useDeleteExpense();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = () =>
    remove.mutate(expense.id, {
      onSuccess: onDeleted,
      onError: (e) => {
        setConfirming(false);
        setError(
          isApiError(e, 409, 'HAS_CHARGES')
            ? t('finance.delete.hasCharges')
            : t('finance.delete.failed'),
        );
      },
    });

  return (
    <div className="flex flex-col gap-2">
      {error && <Banner tone="warn">{error}</Banner>}
      <Button
        variant="danger-text"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        className="min-h-11 self-start md:min-h-10"
      >
        {t('finance.delete.button')}
      </Button>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('finance.delete.title', { name: expense.name })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('finance.cancel')}
            </Button>
            <Button variant="primary" loading={remove.isPending} onClick={confirm}>
              {t('finance.delete.confirm')}
            </Button>
          </>
        }
      >
        {t('finance.delete.body')}
      </Dialog>
    </div>
  );
}
