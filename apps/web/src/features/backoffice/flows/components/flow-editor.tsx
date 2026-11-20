import type { Flow, FlowStep } from '@app/contracts/research';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../../../shared/api/client';
import {
  Badge,
  Banner,
  Button,
  Card,
  Field,
  Input,
  Switch,
  Table,
  type Column,
} from '../../../../shared/ui';
import { useSaveFlow } from '../api/hooks';
import { copy, fill } from '../copy';
import {
  ALWAYS_REQUIRED,
  budgetTotal,
  timeTotal,
  toDraft,
  validate,
  type Draft,
  type Errors,
} from '../lib/draft';

type Scalar = Exclude<keyof Draft, 'steps'>;

interface NumberFieldProps {
  label: string;
  unit?: string;
  hint?: ReactNode;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: 'numeric' | 'decimal' | 'text';
}

function NumberField({
  label,
  unit,
  hint,
  error,
  value,
  onChange,
  inputMode = 'numeric',
}: NumberFieldProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(p) => (
        <div className="flex items-center gap-2">
          <Input
            {...p}
            inputMode={inputMode}
            autoComplete="off"
            className="max-w-32 font-mono"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {unit && <span className="text-sm text-muted">{unit}</span>}
        </div>
      )}
    </Field>
  );
}

/**
 * Server errors mapped onto the form's error keys: 400 `fields` (paths like
 * `runSettings.maxTotalHours`), and 422 STEP_TIME_OVER_ACTIVE_TIME's message under the steps.
 */
function serverErrors(error: unknown): Errors | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 422 && error.code === 'STEP_TIME_OVER_ACTIVE_TIME') {
    return { 'steps.time': error.message };
  }
  if (error.status !== 400 || !error.fields) return null;
  return { ...error.fields };
}

export interface FlowEditorProps {
  flow: Flow;
}

/** FR-37: edit the Local buyers settings and save them as the next flow version. */
export function FlowEditor({ flow }: FlowEditorProps) {
  const save = useSaveFlow(flow.key);
  const [draft, setDraft] = useState<Draft>(() => toDraft(flow));
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState<'saved' | 'failed' | 'gone' | null>(null);
  const next = flow.version + 1;

  const set = (key: Scalar) => (value: string) => {
    setNotice(null);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const setStep = (index: number, patch: Partial<Draft['steps'][number]>) => {
    setNotice(null);
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  };

  function onSave() {
    setNotice(null);
    const result = validate(flow, draft);
    setErrors(result.errors);
    if (!result.input) return;
    save.mutate(result.input, {
      onSuccess: () => setNotice('saved'),
      onError: (error) => {
        const fields = serverErrors(error);
        if (fields) setErrors(fields);
        setNotice(
          fields ? null : error instanceof ApiError && error.status === 404 ? 'gone' : 'failed',
        );
      },
    });
  }

  const total = budgetTotal(draft);
  const minutes = timeTotal(draft);
  const c = flow.ceilings;
  const stepKeys = flow.steps.map((s) => s.key);

  const columns: Column<FlowStep>[] = [
    { key: 'n', header: copy.colNumber, numeric: true, cell: (s) => stepKeys.indexOf(s.key) + 1 },
    {
      key: 'step',
      header: copy.colStep,
      cell: (s) => <span className="font-medium text-fg">{s.name}</span>,
    },
    {
      key: 'tools',
      header: copy.colTools,
      cell: (s) =>
        s.tools.length === 0 ? (
          <span className="text-muted">{copy.noTools}</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {s.tools.map((t) => (
              <code
                key={t}
                className="rounded-tag bg-raised px-1.5 py-0.5 font-mono text-xs text-fg-2"
              >
                {t}
              </code>
            ))}
          </span>
        ),
    },
    {
      key: 'budget',
      header: copy.colBudget,
      cell: (s) => {
        const i = stepKeys.indexOf(s.key);
        const error = errors[`steps.${i}.budgetPct`];
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <Input
                inputMode="numeric"
                autoComplete="off"
                aria-label={fill(copy.budgetLabel, { step: s.name })}
                invalid={Boolean(error)}
                className="h-8 w-20 text-right font-mono"
                value={draft.steps[i]!.budgetPct}
                onChange={(e) => setStep(i, { budgetPct: e.target.value })}
              />
              <span className="text-sm text-muted">{copy.unitPct}</span>
            </div>
            {error && (
              <span role="alert" className="text-xs text-danger">
                {error}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'time',
      header: copy.colTime,
      cell: (s) => {
        const i = stepKeys.indexOf(s.key);
        const error = errors[`steps.${i}.timeLimitMinutes`];
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <Input
                inputMode="numeric"
                autoComplete="off"
                aria-label={fill(copy.timeLabel, { step: s.name })}
                invalid={Boolean(error)}
                className="h-8 w-20 text-right font-mono"
                value={draft.steps[i]!.timeLimitMinutes}
                onChange={(e) => setStep(i, { timeLimitMinutes: e.target.value })}
              />
              <span className="text-sm text-muted">{copy.unitMin}</span>
            </div>
            {error && (
              <span role="alert" className="text-xs text-danger">
                {error}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'required',
      header: copy.colRequired,
      cell: (s) => {
        const i = stepKeys.indexOf(s.key);
        const always = ALWAYS_REQUIRED.has(s.key);
        return (
          <span className="flex items-center gap-2">
            <Switch
              label={fill(copy.requiredLabel, { step: s.name })}
              checked={always || draft.steps[i]!.required}
              disabled={always}
              onCheckedChange={(required) => setStep(i, { required })}
            />
            <span className="text-xs text-muted">
              {always
                ? copy.alwaysRequired
                : draft.steps[i]!.required
                  ? copy.required
                  : copy.optional}
            </span>
          </span>
        );
      },
    },
  ];

  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 flex items-center gap-2 text-xl font-semibold text-fg">
            {flow.name} <Badge>v{flow.version}</Badge>
          </h2>
          <p className="m-0 mt-1 text-sm text-muted">{copy.editorIntro}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(toDraft(flow));
              setErrors({});
              setNotice(null);
            }}
          >
            {copy.discard}
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={onSave}>
            {fill(copy.saveAs, { n: next })}
          </Button>
        </div>
      </div>
      {notice === 'saved' && <Banner>{fill(copy.savedAs, { n: flow.version })}</Banner>}
      {notice === 'failed' && <Banner tone="warn">{copy.saveFailed}</Banner>}
      {notice === 'gone' && <Banner tone="warn">{copy.gone}</Banner>}
      {Object.keys(errors).length > 0 && notice === null && !save.isPending && (
        <Banner tone="warn">{copy.fixErrors}</Banner>
      )}

      <section aria-label={copy.runSettings} className="flex flex-col gap-4">
        <h3 className="m-0 text-base font-semibold text-fg">{copy.runSettings}</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <NumberField
            label={copy.maxActive}
            unit={copy.unitMin}
            hint={fill(copy.ceilingMin, { n: c.maxActiveMinutes })}
            error={errors['runSettings.maxActiveMinutes']}
            value={draft.maxActiveMinutes}
            onChange={set('maxActiveMinutes')}
          />
          <NumberField
            label={copy.maxTotal}
            unit={copy.unitH}
            inputMode="decimal"
            hint={fill(copy.ceilingH, { n: c.maxTotalHours })}
            error={errors['runSettings.maxTotalHours']}
            value={draft.maxTotalHours}
            onChange={set('maxTotalHours')}
          />
          <NumberField
            label={copy.attempts}
            hint={fill(copy.ceilingN, { n: c.maxAttempts })}
            error={errors['runSettings.maxAttempts']}
            value={draft.maxAttempts}
            onChange={set('maxAttempts')}
          />
          <Field
            label={copy.waits}
            hint={copy.waitsHint}
            error={
              errors['runSettings.retryWaitsMinutes'] ?? errors['runSettings.retryWaitsMinutes.0']
            }
          >
            {(p) => (
              <div className="flex items-center gap-2">
                <Input
                  {...p}
                  autoComplete="off"
                  className="max-w-48 font-mono"
                  value={draft.retryWaits}
                  onChange={(e) => set('retryWaits')(e.target.value)}
                />
                <span className="text-sm text-muted">{copy.unitMin}</span>
              </div>
            )}
          </Field>
          <NumberField
            label={copy.stoppedAfter}
            unit={copy.unitMin}
            hint={copy.stoppedHint}
            error={errors['runSettings.workerStoppedAfterMinutes']}
            value={draft.workerStoppedAfterMinutes}
            onChange={set('workerStoppedAfterMinutes')}
          />
          <NumberField
            label={copy.scoreAtBudget}
            unit={copy.unitPct}
            error={errors['runSettings.scoreAtBudgetPct']}
            value={draft.scoreAtBudgetPct}
            onChange={set('scoreAtBudgetPct')}
          />
          <NumberField
            label={copy.scoreAtMinutes}
            unit={copy.unitMin}
            hint={copy.scoreHint}
            error={errors['runSettings.scoreAtMinutes']}
            value={draft.scoreAtMinutes}
            onChange={set('scoreAtMinutes')}
          />
        </div>
      </section>

      <section aria-label={copy.planDefaults} className="flex flex-col gap-4">
        <h3 className="m-0 text-base font-semibold text-fg">{copy.planDefaults}</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <NumberField
            label={copy.maxCredits}
            hint={fill(copy.ceilingN, { n: c.maxCredits })}
            error={errors['planDefaults.maxCredits']}
            value={draft.maxCredits}
            onChange={set('maxCredits')}
          />
          <NumberField
            label={copy.maxLeads}
            hint={fill(copy.ceilingN, { n: c.maxLeads })}
            error={errors['planDefaults.maxLeads']}
            value={draft.maxLeads}
            onChange={set('maxLeads')}
          />
          <NumberField
            label={copy.minFit}
            error={errors['planDefaults.minFitScore']}
            value={draft.minFitScore}
            onChange={set('minFitScore')}
          />
        </div>
        <p className="m-0 text-xs text-faint">{copy.defaultsHint}</p>
      </section>

      <section aria-label={copy.steps} className="flex flex-col gap-3">
        <h3 className="m-0 text-base font-semibold text-fg">{copy.steps}</h3>
        <Table
          caption={copy.stepsCaption}
          columns={columns}
          rows={flow.steps}
          rowKey={(s) => s.key}
        />
        <p
          className={
            total === 100
              ? 'm-0 font-mono text-sm text-accent'
              : 'm-0 font-mono text-sm text-danger'
          }
        >
          {copy.total}:{' '}
          <span>{fill(total === 100 ? copy.totalOk : copy.totalBad, { n: total })}</span> ·{' '}
          {minutes} {copy.unitMin}
        </p>
        {errors.steps && (
          <p role="alert" className="m-0 text-sm text-danger">
            {errors.steps}
          </p>
        )}
        {errors['steps.time'] && (
          <p role="alert" className="m-0 text-sm text-danger">
            {errors['steps.time']}
          </p>
        )}
        <p className="m-0 text-xs text-faint">{copy.stepsHint}</p>
      </section>
      <p className="m-0 text-xs text-faint">
        {copy.ceilingsNote}{' '}
        <Link to="/staff/settings" className="text-accent hover:underline">
          {copy.openSettings}
        </Link>
      </p>
    </Card>
  );
}
