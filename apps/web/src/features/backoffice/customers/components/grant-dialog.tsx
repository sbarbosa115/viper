import { grantCredits } from '@app/contracts/billing';
import type { Customer } from '@app/contracts/reporting';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../../../shared/api/client';
import { Banner, Button, Dialog, Field, Input } from '../../../../shared/ui';
import { useGrantCredits } from '../api/hooks';
import { copy, fill } from '../copy';

type Errors = Partial<Record<'credits' | 'reason', string>>;

function messageFor(path: 'credits' | 'reason', code: string, fallback: string): string {
  if (path === 'reason') return code === 'too_big' ? copy.reasonLong : copy.reasonRequired;
  if (code === 'too_small' || code === 'too_big') return copy.range;
  return code === 'custom' ? fallback : copy.notWhole;
}

export interface GrantDialogProps {
  customer: Customer;
  onClose: () => void;
  onGranted: (message: string) => void;
}

/** FR-13: grant (or remove) credits with a reason; validated with the contract, 422 shown inline. */
export function GrantDialog({ customer, onClose, onGranted }: GrantDialogProps) {
  const grant = useGrantCredits();
  const [credits, setCredits] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [failed, setFailed] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailed(null);
    const parsed = grantCredits.body.safeParse({
      credits: credits.trim() === '' ? Number.NaN : Number(credits),
      reason,
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'credits' || key === 'reason') {
          next[key] ??= messageFor(key, issue.code, issue.message);
        }
      }
      setErrors(next);
      return;
    }
    setErrors({});
    grant.mutate(
      { id: customer.id, ...parsed.data },
      {
        onSuccess: () =>
          onGranted(
            fill(copy.granted, { credits: String(parsed.data.credits), name: customer.name }),
          ),
        onError: (error) => {
          if (error instanceof ApiError && error.status === 422)
            setErrors({ credits: copy.belowZero });
          else if (error instanceof ApiError && error.status === 400 && error.fields) {
            setErrors({
              ...(error.fields.credits ? { credits: error.fields.credits } : {}),
              ...(error.fields.reason ? { reason: error.fields.reason } : {}),
            });
          } else
            setFailed(
              error instanceof ApiError && error.status === 404 ? copy.gone : copy.grantFailed,
            );
        },
      },
    );
  }

  return (
    <Dialog open onClose={onClose} title={fill(copy.grantTitle, { name: customer.name })}>
      <form noValidate onSubmit={onSubmit} aria-label={copy.grant} className="flex flex-col gap-4">
        <p className="m-0 text-sm text-muted">{copy.grantIntro}</p>
        <Field label={copy.credits} hint={copy.creditsHint} error={errors.credits}>
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              autoComplete="off"
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
            />
          )}
        </Field>
        <Field label={copy.reason} hint={copy.reasonHint} error={errors.reason}>
          {(p) => (
            <Input
              {...p}
              autoComplete="off"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        {failed && <Banner tone="warn">{failed}</Banner>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button type="submit" variant="primary" loading={grant.isPending}>
            {copy.submit}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
