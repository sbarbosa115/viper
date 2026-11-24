import { createExpenseBody, type Category, type CreateExpenseBody } from '@app/contracts/finance';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch, type Resolver } from 'react-hook-form';
import { t } from '../../../shared/i18n';
import { Banner, Button, Field, Input, Select, Textarea, cx } from '../../../shared/ui';
import { useCreateExpense, useProviders } from '../api/hooks';
import { applyFieldErrors, isApiError, schemaOptions } from '../lib/form-errors';
import { dayOfMonth, formatDay, todayIso } from '../lib/format';
import { canCoverProvider, CategoryOptions, CoversField } from './expense-fields';
import { MoneyField } from './money-field';
import { Panel } from './panel';

type Mode = 'monthly' | 'yearly' | 'one_off';

/** The form's fields, flat so every input can register by name; the contract body is the schema. */
interface Values {
  kind: 'recurring' | 'one_off';
  cadence: 'monthly' | 'yearly';
  name: string;
  vendor: string;
  category: Category;
  amountCents?: number;
  startsOn?: string;
  spentOn?: string;
  coversProvider?: string;
  link?: string;
  notes?: string;
}

const fieldNames = [
  'name',
  'vendor',
  'category',
  'amountCents',
  'startsOn',
  'spentOn',
  'coversProvider',
  'link',
  'notes',
] as const;

/** Empty text means "not given", so optional contract fields stay absent. */
const optionalText = {
  setValueAs: (v: string | undefined) =>
    v === undefined || v.trim() === '' ? undefined : v.trim(),
};

const modes: {
  id: Mode;
  label: 'finance.exp.monthly' | 'finance.exp.yearly' | 'finance.exp.oneOff';
}[] = [
  { id: 'monthly', label: 'finance.exp.monthly' },
  { id: 'yearly', label: 'finance.exp.yearly' },
  { id: 'one_off', label: 'finance.exp.oneOff' },
];

export function ExpenseCreate({ onClose }: { onClose: () => void }) {
  const create = useCreateExpense();
  const [mode, setMode] = useState<Mode>('monthly');
  const [formError, setFormError] = useState<string | null>(null);
  const today = todayIso();
  const form = useForm<Values, unknown, CreateExpenseBody>({
    // The contract body is a discriminated union; the flat Values type is its superset.
    resolver: zodResolver(createExpenseBody, schemaOptions) as unknown as Resolver<
      Values,
      unknown,
      CreateExpenseBody
    >,
    defaultValues: {
      kind: 'recurring',
      cadence: 'monthly',
      name: '',
      vendor: '',
      category: 'hosting',
      startsOn: today,
      spentOn: today,
    },
  });
  const { register, control, handleSubmit, setError, setValue, formState } = form;
  const { errors } = formState;
  const category = useWatch({ control, name: 'category' });
  const startsOn = useWatch({ control, name: 'startsOn' });
  const coversAllowed = mode !== 'one_off' && canCoverProvider(category);
  const providers = useProviders(coversAllowed);

  function pickMode(next: Mode) {
    setMode(next);
    setValue('kind', next === 'one_off' ? 'one_off' : 'recurring');
    if (next !== 'one_off') setValue('cadence', next);
  }

  const onSubmit = (body: CreateExpenseBody) => {
    setFormError(null);
    create.mutate(body, {
      onSuccess: onClose,
      onError: (error) => {
        if (isApiError(error, 409, 'PROVIDER_ALREADY_COVERED')) {
          const name = typeof error.details?.name === 'string' ? error.details.name : '';
          setFormError(t('finance.form.coveredBy', { name }));
        } else if (isApiError(error, 422, 'BEFORE_HISTORY_START')) {
          setFormError(t('finance.form.beforeStart'));
        } else if (isApiError(error, 422, 'COVERS_PROVIDER_CATEGORY')) {
          setFormError(t('finance.form.coversCategory'));
        } else if (isApiError(error, 404, 'UNKNOWN_PROVIDER')) {
          setFormError(t('finance.form.unknownProvider'));
        } else if (!applyFieldErrors(error, fieldNames, setError)) {
          setFormError(t('finance.form.failed'));
        }
      },
    });
  };

  const hint =
    mode === 'monthly' && startsOn
      ? t('finance.form.hintMonthly', { day: dayOfMonth(startsOn) })
      : mode === 'yearly' && startsOn
        ? t('finance.form.hintYearly', { date: formatDay(startsOn) })
        : null;

  return (
    <Panel title={t('finance.form.addTitle')} onClose={onClose}>
      <form
        noValidate
        aria-label={t('finance.form.addTitle')}
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        className="flex flex-col gap-4"
      >
        <div
          role="radiogroup"
          aria-label={t('finance.form.kind')}
          className="grid grid-cols-3 gap-1 rounded-control border border-line-control p-1"
        >
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              onClick={() => pickMode(m.id)}
              className={cx(
                'min-h-11 rounded-sm text-sm font-medium md:min-h-9',
                mode === m.id ? 'bg-raised text-fg' : 'text-muted hover:text-fg',
              )}
            >
              {t(m.label)}
            </button>
          ))}
        </div>
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
                  if (!canCoverProvider(e.target.value)) setValue('coversProvider', undefined);
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
              <Select {...p} {...register('coversProvider', optionalText)}>
                {options}
              </Select>
            )}
          </CoversField>
        )}
        <div className="grid grid-cols-2 gap-3">
          <MoneyField control={control} name="amountCents" label={t('finance.form.amount')} />
          {mode === 'one_off' ? (
            <Field label={t('finance.form.spentOn')} error={errors.spentOn?.message}>
              {(p) => (
                <Input {...p} type="date" min="2026-11-01" max={today} {...register('spentOn')} />
              )}
            </Field>
          ) : (
            <Field label={t('finance.form.firstCharge')} error={errors.startsOn?.message}>
              {(p) => <Input {...p} type="date" min="2026-11-01" {...register('startsOn')} />}
            </Field>
          )}
        </div>
        {hint && (
          <p className="m-0 text-xs text-faint">
            {hint} {t('finance.form.hintEnd')}
          </p>
        )}
        <Field
          label={t('finance.form.link')}
          hint={t('finance.form.linkHint')}
          error={errors.link?.message}
        >
          {(p) => (
            <Input {...p} inputMode="url" autoComplete="off" {...register('link', optionalText)} />
          )}
        </Field>
        <Field label={t('finance.form.notes')} error={errors.notes?.message}>
          {(p) => <Textarea {...p} rows={2} {...register('notes', optionalText)} />}
        </Field>
        {formError && <Banner tone="warn">{formError}</Banner>}
        <Button type="submit" variant="primary" size="lg" loading={create.isPending}>
          {t('finance.form.submit')}
        </Button>
      </form>
    </Panel>
  );
}
