import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Banner, Button, ErrorState, Icon, Spinner } from '../../../shared/ui';
import { useResendVerification, useVerifyEmail } from '../api/hooks';
import { copy } from '../copy';
import { isApiError } from '../lib/form-errors';

function ExpiredLink() {
  const resend = useResendVerification();
  const [result, setResult] = useState<'sent' | 'tooMany' | 'login' | 'other' | null>(null);

  const onSend = () =>
    resend.mutate(undefined, {
      onSuccess: () => setResult('sent'),
      onError: (error) => {
        if (isApiError(error, 429)) setResult('tooMany');
        else if (isApiError(error, 401)) setResult('login');
        else setResult('other');
      },
    });

  return (
    <div className="flex flex-col gap-4">
      <h2 className="m-0 text-[22px] font-semibold text-fg">{copy.verify.expiredTitle}</h2>
      <p className="m-0 text-sm text-muted">{copy.verify.expiredBody}</p>
      {result === 'sent' && <Banner>{copy.verify.sent}</Banner>}
      {result === 'tooMany' && <Banner tone="warn">{copy.verify.tooMany}</Banner>}
      {result === 'other' && <Banner tone="warn">{copy.common.network}</Banner>}
      {result === 'login' && (
        <Banner tone="warn">
          {copy.verify.needLogin}{' '}
          <Link to="/login?next=%2Fverify-email" className="text-accent underline">
            {copy.verify.login}
          </Link>
        </Banner>
      )}
      <Button variant="primary" size="lg" loading={resend.isPending} onClick={onSend}>
        {copy.verify.sendNew}
      </Button>
    </div>
  );
}

/** FR-2: opens the emailed link. */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const verify = useVerifyEmail(token);

  if (token === null) return <ExpiredLink />;
  if (verify.isPending) {
    return (
      <div className="grid place-items-center gap-3 py-10">
        <Spinner label={copy.verify.checking} />
      </div>
    );
  }
  if (verify.isError) {
    if (isApiError(verify.error, 410)) return <ExpiredLink />;
    return <ErrorState onRetry={() => void verify.refetch()} />;
  }
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-accent-tint text-accent">
        <Icon name="check" size={26} />
      </span>
      <h2 className="m-0 text-[22px] font-semibold text-fg">{copy.verify.doneTitle}</h2>
      <p className="m-0 text-sm text-muted">{copy.verify.doneBody}</p>
      <Link
        to="/"
        className="mt-2 inline-flex h-12 items-center rounded-row bg-accent px-5 text-[15px] font-semibold text-accent-ink hover:bg-accent-hover"
      >
        {copy.verify.cont}
      </Link>
    </div>
  );
}
