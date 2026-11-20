import { requestPasswordReset } from '@app/contracts/identity';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { Banner, Button, Field, Input } from '../../../shared/ui';
import { useRequestPasswordReset } from '../api/hooks';
import { copy } from '../copy';
import { isApiError, schemaOptions } from '../lib/form-errors';

const schema = z.object({ email: requestPasswordReset.body.shape.email });
interface Values {
  email: string;
}

export function ForgotPasswordPage() {
  const request = useRequestPasswordReset();
  const [result, setResult] = useState<'sent' | 'tooMany' | 'other' | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema, schemaOptions),
    defaultValues: { email: '' },
  });

  const onSubmit = async ({ email }: { email: string }) => {
    setResult(null);
    try {
      await request.mutateAsync(email);
      setResult('sent');
    } catch (error) {
      setResult(isApiError(error, 429) ? 'tooMany' : 'other');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 className="m-0 text-[22px] font-semibold text-fg">{copy.forgot.title}</h2>
        <p className="m-0 text-sm text-muted">{copy.forgot.subtitle}</p>
      </header>
      <form
        noValidate
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        className="flex flex-col gap-3"
      >
        <Field label={copy.forgot.email} error={errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" {...register('email')} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={request.isPending}>
          {copy.forgot.submit}
        </Button>
      </form>
      {result === 'sent' && <Banner>{copy.forgot.sent}</Banner>}
      {result === 'tooMany' && <Banner tone="warn">{copy.forgot.tooMany}</Banner>}
      {result === 'other' && <Banner tone="warn">{copy.common.network}</Banner>}
      <Link to="/login" className="text-center text-sm text-accent underline">
        {copy.forgot.back}
      </Link>
    </div>
  );
}
