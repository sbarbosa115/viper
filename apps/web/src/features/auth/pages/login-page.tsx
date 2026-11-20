import { loginBody, type LoginBody } from '@app/contracts/identity';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, Field, Input } from '../../../shared/ui';
import { useCommitMe, useLogin } from '../api/hooks';
import { FormError } from '../components/form-error';
import { copy } from '../copy';
import { applyFieldErrors, isApiError, schemaOptions } from '../lib/form-errors';
import { safeNext } from '../lib/next';

interface Values {
  email: string;
  password: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const commitMe = useCommitMe();
  const login = useLogin();
  const [formError, setFormError] = useState<'invalid' | 'tooMany' | 'other' | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Values, unknown, LoginBody>({
    resolver: zodResolver(loginBody, schemaOptions),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (body: LoginBody) => {
    setFormError(null);
    try {
      const me = await login.mutateAsync(body);
      const needsCode = me.twoFactor.required && !me.twoFactor.passed;
      const twoFactorPath = next
        ? `/login/two-factor?next=${encodeURIComponent(next)}`
        : '/login/two-factor';
      commitMe(me);
      await navigate(needsCode ? twoFactorPath : (next ?? '/'), { replace: true });
    } catch (error) {
      if (isApiError(error, 401, 'INVALID_CREDENTIALS')) setFormError('invalid');
      else if (isApiError(error, 429)) setFormError('tooMany');
      else if (!applyFieldErrors(error, ['email', 'password'], setError)) setFormError('other');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <h2 className="m-0 text-[22px] font-semibold text-fg">{copy.login.title}</h2>
      <form noValidate onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-3">
        <Field label={copy.login.email} error={errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" {...register('email')} />}
        </Field>
        <Field label={copy.login.password} error={errors.password?.message}>
          {(p) => (
            <Input {...p} type="password" autoComplete="current-password" {...register('password')} />
          )}
        </Field>
        <Link to="/forgot-password" className="text-sm text-accent underline">
          {copy.login.forgot}
        </Link>
        {formError === 'invalid' && <FormError>{copy.login.invalid}</FormError>}
        {formError === 'tooMany' && <FormError>{copy.login.tooMany}</FormError>}
        {formError === 'other' && <FormError>{copy.common.network}</FormError>}
        <Button type="submit" variant="primary" size="lg" loading={login.isPending}>
          {copy.login.submit}
        </Button>
      </form>
      <p className="m-0 text-xs text-faint">{copy.login.staffHint}</p>
      <p className="m-0 text-center text-sm text-muted">
        {copy.login.newHere}{' '}
        <Link to="/signup" className="text-accent underline">
          {copy.login.create}
        </Link>
      </p>
    </div>
  );
}
