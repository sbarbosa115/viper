import { newPassword } from '@app/contracts/identity';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { Button, Field, Input } from '../../../shared/ui';
import { useCommitMe, useConfirmPasswordReset } from '../api/hooks';
import { FormError } from '../components/form-error';
import { copy } from '../copy';
import { applyFieldErrors, isApiError, schemaOptions } from '../lib/form-errors';

const schema = z
  .object({ password: newPassword, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: copy.reset.mismatch });
interface Values {
  password: string;
  confirm: string;
}

function ExpiredReset() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="m-0 text-[22px] font-semibold text-fg">{copy.reset.expiredTitle}</h2>
      <p className="m-0 text-sm text-muted">{copy.reset.expiredBody}</p>
      <Link
        to="/forgot-password"
        className="inline-flex h-12 items-center justify-center rounded-row bg-accent px-5 text-[15px] font-semibold text-accent-ink hover:bg-accent-hover"
      >
        {copy.reset.request}
      </Link>
    </div>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();
  const commitMe = useCommitMe();
  const confirm = useConfirmPasswordReset();
  const [expired, setExpired] = useState(false);
  const [formError, setFormError] = useState<'tooMany' | 'other' | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Values, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema, schemaOptions),
    defaultValues: { password: '', confirm: '' },
  });

  if (!token || expired) return <ExpiredReset />;

  const onSubmit = async ({ password }: { password: string }) => {
    setFormError(null);
    try {
      const me = await confirm.mutateAsync({ token, password });
      const needsCode = me.twoFactor.required && !me.twoFactor.passed;
      commitMe(me);
      await navigate(needsCode ? '/login/two-factor' : '/', { replace: true });
    } catch (error) {
      if (isApiError(error, 410)) setExpired(true);
      else if (isApiError(error, 429)) setFormError('tooMany');
      else if (!applyFieldErrors(error, ['password'], setError)) setFormError('other');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <h2 className="m-0 text-[22px] font-semibold text-fg">{copy.reset.title}</h2>
      <form
        noValidate
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        className="flex flex-col gap-3"
      >
        <Field
          label={copy.reset.password}
          hint={copy.reset.passwordHint}
          error={errors.password?.message}
        >
          {(p) => (
            <Input {...p} type="password" autoComplete="new-password" {...register('password')} />
          )}
        </Field>
        <Field label={copy.reset.confirm} error={errors.confirm?.message}>
          {(p) => (
            <Input {...p} type="password" autoComplete="new-password" {...register('confirm')} />
          )}
        </Field>
        {formError === 'tooMany' && <FormError>{copy.forgot.tooMany}</FormError>}
        {formError === 'other' && <FormError>{copy.common.network}</FormError>}
        <Button type="submit" variant="primary" size="lg" loading={confirm.isPending}>
          {copy.reset.submit}
        </Button>
      </form>
      <p className="m-0 text-xs text-faint">{copy.reset.note}</p>
    </div>
  );
}
