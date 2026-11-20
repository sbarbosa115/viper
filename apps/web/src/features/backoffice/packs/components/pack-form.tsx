import { creditPackInput, type CreditPack } from '@app/contracts/billing';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../../../shared/api/client';
import { Banner, Button, Card, Checkbox, Field, Input } from '../../../../shared/ui';
import { useSavePack } from '../api/hooks';
import { copy, fill } from '../copy';
import { centsToDollars, dollarsToCents } from '../lib/format';

export interface PackFormProps {
  /** The pack being edited; null for a new pack. */
  pack: CreditPack | null;
  onDone: () => void;
}

type Errors = Partial<Record<'name' | 'credits' | 'priceCents', string>>;

function fieldErrors(error: unknown): Errors {
  if (!(error instanceof ApiError) || !error.fields) return {};
  const { name, credits, priceCents } = error.fields;
  return {
    ...(name ? { name } : {}),
    ...(credits ? { credits } : {}),
    ...(priceCents ? { priceCents } : {}),
  };
}

/** Create or edit a Credit pack (FR-13), validated with the contract. */
export function PackForm({ pack, onDone }: PackFormProps) {
  const save = useSavePack();
  const [name, setName] = useState(pack?.name ?? '');
  const [credits, setCredits] = useState(pack ? String(pack.credits) : '');
  const [price, setPrice] = useState(pack ? centsToDollars(pack.priceCents) : '');
  const [active, setActive] = useState(pack?.active ?? true);
  const [errors, setErrors] = useState<Errors>({});
  const [failed, setFailed] = useState<string | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFailed(null);
    const candidate = {
      name: name.trim(),
      credits: credits.trim() === '' ? undefined : Number(credits),
      priceCents: dollarsToCents(price),
      active,
    };
    const parsed = creditPackInput.safeParse(candidate, {
      error: (issue) =>
        issue.code === 'invalid_type' || (issue.code === 'too_small' && issue.input === '')
          ? copy.required
          : undefined,
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'name' || key === 'credits' || key === 'priceCents')
          next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate(
      { id: pack?.id ?? null, input: parsed.data },
      {
        onSuccess: onDone,
        onError: (error) => {
          const fromApi = fieldErrors(error);
          setErrors(fromApi);
          if (Object.keys(fromApi).length > 0) return;
          setFailed(
            error instanceof ApiError && error.status === 404 ? copy.gone : copy.saveFailed,
          );
        },
      },
    );
  };

  const title = pack ? fill(copy.editPack, { name: pack.name }) : copy.newPack;
  return (
    <Card className="flex flex-col gap-4">
      <form
        noValidate
        aria-labelledby="pack-form-title"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <h2 id="pack-form-title" className="m-0 text-lg font-semibold text-fg">
          {title}
        </h2>
        <Field label={copy.name} error={errors.name}>
          {(p) => (
            <Input
              {...p}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <Field label={copy.credits} error={errors.credits}>
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <Field label={copy.price} error={errors.priceCents}>
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <Checkbox
          label={copy.activeLabel}
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        {failed && <Banner tone="warn">{failed}</Banner>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={save.isPending}>
            {copy.save}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            {copy.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
