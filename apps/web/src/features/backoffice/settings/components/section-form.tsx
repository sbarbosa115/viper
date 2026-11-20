import type { SettingsSection } from '@app/contracts/platform';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../../../../shared/api/client';
import { Banner, Button, Card, Field, Input, Select, Switch } from '../../../../shared/ui';
import { useSaveSection } from '../api/hooks';
import { copy, sectionTitles } from '../copy';
import {
  buildBody,
  getPath,
  initialValues,
  sectionFields,
  type FieldDef,
  type FormValues,
} from '../lib/fields';
import { validateSection } from '../lib/validate';
import { SecretField } from './secret-field';
import type { Secret } from '@app/contracts/platform';

export interface SectionFormProps {
  section: SettingsSection;
  /** The section as GET returned it. */
  data: unknown;
  /** Extra controls under the fields (the SMTP test). */
  footer?: (state: { values: FormValues }) => ReactNode;
}

function serverErrors(error: unknown, section: SettingsSection): Record<string, string> {
  if (!(error instanceof ApiError) || !error.fields) return {};
  const out: Record<string, string> = {};
  for (const [path, message] of Object.entries(error.fields)) {
    out[path.startsWith(`${section}.`) ? path.slice(section.length + 1) : path] = message;
  }
  return out;
}

function Control({
  def,
  value,
  error,
  onChange,
}: {
  def: FieldDef;
  value: string | boolean | undefined;
  error: string | undefined;
  onChange: (v: string | boolean) => void;
}) {
  if (def.kind === 'switch') {
    return (
      <div className="flex items-center gap-3">
        <Switch checked={value === true} onCheckedChange={onChange} label={def.label} />
        <span className="text-sm text-fg-2">{def.label}</span>
      </div>
    );
  }
  return (
    <Field label={def.label} hint={def.hint} error={error}>
      {(p) =>
        def.kind === 'select' ? (
          <Select {...p} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
            {def.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            {...p}
            type={def.kind === 'email' ? 'email' : 'text'}
            inputMode={def.inputMode}
            autoComplete="off"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      }
    </Field>
  );
}

/** One settings section with its own Save (FR-8): validated with the contract, secrets write-only. */
export function SectionForm({ section, data, footer }: SectionFormProps) {
  const fields = sectionFields[section];
  const save = useSaveSection(section);
  const [values, setValues] = useState<FormValues>(() => initialValues(fields, data));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<'saved' | 'failed' | null>(null);
  // Remounting secret fields after a save resets their Replace / Remove state.
  const [version, setVersion] = useState(0);
  const title = sectionTitles[section];

  const set = (path: string, v: string | boolean | undefined) => {
    setValues((old) => ({ ...old, [path]: v }));
    setOutcome(null);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setOutcome(null);
    const body = buildBody(fields, values);
    const problems = validateSection(section, body);
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    save.mutate(body, {
      onSuccess: (saved) => {
        setValues(initialValues(fields, saved));
        setVersion((n) => n + 1);
        setOutcome('saved');
      },
      onError: (error) => {
        const fromApi = serverErrors(error, section);
        setErrors(fromApi);
        if (Object.keys(fromApi).length === 0) setOutcome('failed');
      },
    });
  };

  return (
    <Card className="flex flex-col gap-4" id={`settings-${section}`}>
      <form
        noValidate
        aria-labelledby={`settings-${section}-title`}
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={`settings-${section}-title`} className="m-0 text-lg font-semibold text-fg">
            {title}
          </h2>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={save.isPending}
            aria-label={`${copy.save} ${title}`}
          >
            {copy.save}
          </Button>
        </div>
        <div className="flex flex-col gap-4" key={version}>
          {fields.map((def) =>
            def.kind === 'secret' ? (
              <SecretField
                key={def.path}
                def={def}
                secret={
                  (getPath(data, def.path) ?? {
                    set: false,
                    last4: null,
                    updatedAt: null,
                  }) as Secret
                }
                value={values[def.path] as string | undefined}
                onChange={(v) => set(def.path, v)}
                error={errors[def.path]}
              />
            ) : (
              <Control
                key={def.path}
                def={def}
                value={values[def.path]}
                error={errors[def.path]}
                onChange={(v) => set(def.path, v)}
              />
            ),
          )}
        </div>
        {footer?.({ values })}
        {outcome === 'saved' && (
          <p role="status" className="m-0 text-sm text-accent">
            ● {title}: {copy.saved}
          </p>
        )}
        {outcome === 'failed' && <Banner tone="warn">{copy.saveFailed}</Banner>}
      </form>
    </Card>
  );
}
