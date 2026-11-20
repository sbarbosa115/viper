import type { Plan } from '@app/contracts/planning';
import type { Product } from '@app/contracts/profile';
import { useEffect, useState } from 'react';
import { Controller, useForm, type Path } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { ApiError } from '../../../shared/api/client';
import { Banner, Button, Card, Field, Input, useToast } from '../../../shared/ui';
import { useStartRun, useUpdatePlan } from '../api/hooks';
import { copy, fill } from '../copy';
import { isActiveRun, creditsShortfall } from '../lib/runs';
import { planResolver, toBody, toValues, type PlanFormValues } from '../lib/plan-form';
import { AreaEditor } from './area-editor';
import { LinkButton } from './link-button';
import { NoCreditsDialog } from './no-credits-dialog';
import { SegmentsEditor } from './segments-editor';

export interface PlanEditorProps {
  plan: Plan;
  products: Product[];
}

interface Problem {
  text: string;
  action?: { to: string; label: string };
}

function startProblem(error: unknown, plan: Plan): Problem {
  const code = error instanceof ApiError ? error.code : '';
  if (code === 'EMAIL_NOT_VERIFIED') return { text: copy.notVerified };
  if (code === 'RUN_IN_PROGRESS') {
    const to = isActiveRun(plan.lastRun) ? `/runs/${plan.lastRun.id}` : '/plans';
    return { text: copy.inProgress, action: { to, label: copy.viewProgress } };
  }
  if (code === 'RESEARCH_UNAVAILABLE') return { text: copy.researchUnavailable };
  return { text: copy.startFailed };
}

function segmentMessage(errors: unknown, index: number, key: string): string | undefined {
  if (!Array.isArray(errors)) return undefined;
  const entry = errors[index] as Record<string, { message?: string } | undefined> | undefined;
  return entry?.[key]?.message;
}

/** FR-17 and the client side of FR-18: edit the Plan, see the estimate, find leads. */
export function PlanEditor({ plan, products }: PlanEditorProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const update = useUpdatePlan(plan.id);
  const start = useStartRun(plan.id);
  const form = useForm<PlanFormValues>({ defaultValues: toValues(plan), resolver: planResolver });
  const { control, handleSubmit, reset, setError, formState, register } = form;
  const { errors, isDirty } = formState;
  const [problem, setProblem] = useState<Problem | null>(null);
  const [shortfall, setShortfall] = useState<{ available: number; required: number } | null>(null);

  // Another Plan (route change) starts from its own values; refetches never clobber edits.
  useEffect(() => reset(toValues(plan)), [plan.id, reset]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = isActiveRun(plan.lastRun) ? plan.lastRun : null;

  /** Saves the form; false when the server or the schema refused it. */
  const save = async (values: PlanFormValues, announce: boolean): Promise<boolean> => {
    try {
      const saved = await update.mutateAsync(toBody(values));
      reset(toValues(saved));
      if (announce) toast({ message: copy.saved });
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.fields) {
        for (const [path, text] of Object.entries(error.fields)) {
          setError(path as Path<PlanFormValues>, { message: text });
        }
      } else if (error instanceof ApiError && error.code === 'ADDRESS_NOT_FOUND') {
        setError('searchArea.label', { message: copy.addressNotFound });
      } else {
        setProblem({ text: copy.saveFailed });
      }
      return false;
    }
  };

  const onSave = handleSubmit((values) => void save(values, true));

  const begin = () => {
    setProblem(null);
    start.mutate(undefined, {
      onSuccess: (run) => void navigate(`/runs/${run.id}`),
      onError: (error) => {
        if (error instanceof ApiError && error.status === 402) {
          setShortfall(
            creditsShortfall(error, {
              available: plan.available,
              required: plan.guardrails.maxCredits,
            }),
          );
        } else {
          setProblem(startProblem(error, plan));
        }
      },
    });
  };

  const findLeads = async () => {
    setProblem(null);
    if (isDirty) {
      let saved = false;
      await handleSubmit(async (values) => {
        saved = await save(values, false);
      })();
      if (!saved) return;
    }
    begin();
  };

  const lowerBudget = async () => {
    if (!shortfall) return;
    try {
      const saved = await update.mutateAsync({
        guardrails: { ...plan.guardrails, maxCredits: shortfall.available },
      });
      reset(toValues(saved));
      setShortfall(null);
      begin();
    } catch {
      setShortfall(null);
      setProblem({ text: copy.saveFailed });
    }
  };

  const number = (
    name: 'guardrails.maxCredits' | 'guardrails.maxLeads' | 'guardrails.minFitScore',
    label: string,
  ) => {
    const key = name.split('.')[1] as 'maxCredits' | 'maxLeads' | 'minFitScore';
    return (
      <Field label={label} error={errors.guardrails?.[key]?.message}>
        {(props) => (
          <Input
            {...props}
            type="number"
            inputMode="numeric"
            {...register(name, { valueAsNumber: true })}
          />
        )}
      </Field>
    );
  };

  return (
    <form onSubmit={(e) => void onSave(e)} noValidate className="flex flex-col gap-6">
      {problem && (
        <Banner
          tone="warn"
          action={
            problem.action && <LinkButton to={problem.action.to}>{problem.action.label}</LinkButton>
          }
        >
          {problem.text}
        </Banner>
      )}

      <Field label={copy.planName} error={errors.name?.message}>
        {(props) => <Input {...props} maxLength={60} {...register('name')} />}
      </Field>

      <Controller
        control={control}
        name="segments"
        render={({ field }) => (
          <SegmentsEditor
            segments={field.value}
            products={products}
            messageOf={(i, key) => segmentMessage(errors.segments, i, key)}
            onChange={field.onChange}
          />
        )}
      />

      <Controller
        control={control}
        name="searchArea"
        render={({ field }) => (
          <AreaEditor
            value={field.value}
            radiusError={errors.searchArea?.radiusMiles?.message}
            areaError={errors.searchArea?.label?.message ?? errors.searchArea?.lat?.message}
            onChange={field.onChange}
          />
        )}
      />

      <Card className="flex flex-col gap-4">
        <h2 className="m-0 text-base font-semibold text-fg">{copy.budget}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {number('guardrails.maxCredits', copy.maxCredits)}
          {number('guardrails.maxLeads', copy.maxLeads)}
          {number('guardrails.minFitScore', copy.minFit)}
        </div>
      </Card>

      <Card tone="accent" className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="m-0 font-mono text-lg text-fg">
            {fill(copy.estimate, {
              max: plan.estimate.maxCredits,
              typical: plan.estimate.typicalCredits,
            })}
          </p>
          <p className="m-0 text-sm text-muted">{fill(copy.available, { n: plan.available })}</p>
          {isDirty && <p className="m-0 text-xs text-faint">{copy.unsaved}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isDirty && (
            <Button type="submit" loading={update.isPending && !start.isPending}>
              {copy.save}
            </Button>
          )}
          {plan.leadsCount > 0 && (
            <LinkButton to={`/plans/${plan.id}/leads`}>
              {fill(copy.viewLeads, { n: plan.leadsCount })}
            </LinkButton>
          )}
          {active ? (
            <LinkButton variant="primary" to={`/runs/${active.id}`}>
              {copy.viewProgress}
            </LinkButton>
          ) : (
            <Button variant="primary" loading={start.isPending} onClick={() => void findLeads()}>
              {copy.findLeads}
            </Button>
          )}
        </div>
      </Card>

      {shortfall && (
        <NoCreditsDialog
          shortfall={shortfall}
          busy={update.isPending || start.isPending}
          onLower={() => void lowerBudget()}
          onBuy={() => void navigate('/credits')}
          onClose={() => setShortfall(null)}
        />
      )}
    </form>
  );
}
