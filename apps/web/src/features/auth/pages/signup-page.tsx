import { signupBody, type SignupBody } from '@app/contracts/identity';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { Button, Field, Input } from '../../../shared/ui';
import { useCommitMe, useSignup } from '../api/hooks';
import { FormError } from '../components/form-error';
import { copy } from '../copy';
import { applyFieldErrors, isApiError, schemaOptions } from '../lib/form-errors';

const fieldNames = ['businessName', 'name', 'email', 'password'] as const;

interface Values {
  businessName: string;
  name: string;
  email: string;
  password: string;
}

export function SignupPage() {
  const navigate = useNavigate();
  const commitMe = useCommitMe();
  const signup = useSignup();
  const [formError, setFormError] = useState<'taken' | 'tooMany' | 'other' | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Values, unknown, SignupBody>({
    resolver: zodResolver(signupBody, schemaOptions),
    defaultValues: { businessName: '', name: '', email: '', password: '' },
  });

  const onSubmit = async (body: SignupBody) => {
    setFormError(null);
    try {
      const me = await signup.mutateAsync(body);
      commitMe(me);
      await navigate('/', { replace: true });
    } catch (error) {
      if (isApiError(error, 409, 'EMAIL_TAKEN')) setFormError('taken');
      else if (isApiError(error, 429)) setFormError('tooMany');
      else if (!applyFieldErrors(error, fieldNames, setError)) setFormError('other');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 className="m-0 text-[22px] font-semibold text-fg">{copy.signup.title}</h2>
        <p className="m-0 text-sm text-muted">{copy.signup.subtitle}</p>
      </header>
      <form
        noValidate
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        className="flex flex-col gap-3"
      >
        <Field label={copy.signup.businessName} error={errors.businessName?.message}>
          {(p) => <Input {...p} autoComplete="organization" {...register('businessName')} />}
        </Field>
        <Field label={copy.signup.name} error={errors.name?.message}>
          {(p) => <Input {...p} autoComplete="name" {...register('name')} />}
        </Field>
        <Field label={copy.signup.email} error={errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" {...register('email')} />}
        </Field>
        <Field
          label={copy.signup.password}
          hint={copy.signup.passwordHint}
          error={errors.password?.message}
        >
          {(p) => (
            <Input {...p} type="password" autoComplete="new-password" {...register('password')} />
          )}
        </Field>
        {formError === 'taken' && (
          <FormError>
            {copy.signup.emailTaken}{' '}
            <Link to="/login" className="text-accent underline">
              {copy.login.title}
            </Link>
          </FormError>
        )}
        {formError === 'tooMany' && <FormError>{copy.signup.tooMany}</FormError>}
        {formError === 'other' && <FormError>{copy.common.network}</FormError>}
        <Button type="submit" variant="primary" size="lg" loading={signup.isPending}>
          {copy.signup.submit}
        </Button>
      </form>
      <p className="m-0 text-xs text-faint">
        {copy.signup.legalPrefix}{' '}
        <a href="/terms" className="text-accent underline">
          {copy.signup.terms}
        </a>{' '}
        {copy.signup.and}{' '}
        <a href="/privacy" className="text-accent underline">
          {copy.signup.privacy}
        </a>
        .
      </p>
      <p className="m-0 text-center text-sm text-muted">
        {copy.signup.haveAccount}{' '}
        <Link to="/login" className="text-accent underline">
          {copy.login.title}
        </Link>
      </p>
    </div>
  );
}
