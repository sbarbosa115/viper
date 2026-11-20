import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '../../../shared/api/client';
import { useResendVerification } from '../../../shared/api/verification';
import { Banner, Button, Chip, Field, Spinner, Textarea } from '../../../shared/ui';
import { useCreatePlan, useProducts } from '../api/hooks';
import { LinkButton } from '../components/link-button';
import { copy, fill } from '../copy';

/** 403 EMAIL_NOT_VERIFIED: drafting needs a verified email; offers a new link. */
function VerifyEmailPrompt() {
  const resend = useResendVerification();
  const [message, setMessage] = useState<string | null>(null);
  const onResend = () =>
    resend.mutate(undefined, {
      onSuccess: () => setMessage(copy.resendSent),
      onError: (error) =>
        setMessage(
          error instanceof ApiError && error.status === 429
            ? copy.resendTooMany
            : copy.resendFailed,
        ),
    });
  return (
    <Banner
      tone="warn"
      action={
        <Button size="sm" variant="secondary" loading={resend.isPending} onClick={onResend}>
          {copy.resendEmail}
        </Button>
      }
    >
      {copy.emailNotVerified}
      {message && (
        <span role="status" className="ml-2 text-muted">
          {' '}
          · {message}
        </span>
      )}
    </Banner>
  );
}

/** 429 TOO_MANY_REQUESTS: the daily limit of new Plans, with the limit the server sent. */
function dailyLimitText(error: ApiError): string {
  const limit = error.details?.limit;
  return typeof limit === 'number'
    ? fill(copy.dailyPlanLimit, { limit })
    : copy.dailyPlanLimitNoCount;
}

/** FR-16: a goal box that drafts a Plan. */
export function NewPlanPage() {
  const navigate = useNavigate();
  const create = useCreatePlan();
  const profile = useProducts();
  const [goal, setGoal] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const suggestions = (profile.data?.products ?? [])
    .slice(0, 3)
    .map((p) => fill(copy.suggestion, { product: p.name }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = goal.trim();
    if (text.length < 5) return setFieldError(copy.goalTooShort);
    if (text.length > 500) return setFieldError(copy.goalTooLong);
    setFieldError(null);
    create.mutate(text, {
      onSuccess: (plan) =>
        void navigate(`/plans/${plan.id}`, { state: { warnings: plan.warnings ?? [] } }),
      onError: (error) => {
        if (error instanceof ApiError && error.fields?.goal) setFieldError(error.fields.goal);
      },
    });
  };

  const error = create.error;
  const incomplete = error instanceof ApiError && error.code === 'PROFILE_INCOMPLETE';
  const invalid = error instanceof ApiError && Boolean(error.fields?.goal);
  const unverified = error instanceof ApiError && error.code === 'EMAIL_NOT_VERIFIED';
  const limited = error instanceof ApiError && error.code === 'TOO_MANY_REQUESTS';
  const handled = incomplete || invalid || unverified || limited;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 md:px-7">
      <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">{copy.newTitle}</h1>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <Field label={copy.goalLabel} hint={copy.goalHint} error={fieldError}>
          {(props) => (
            <Textarea
              {...props}
              value={goal}
              disabled={create.isPending}
              onChange={(e) => setGoal(e.target.value)}
            />
          )}
        </Field>
        {suggestions.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              {copy.suggestions}
            </span>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <Chip key={s} kind="choice" onSelectedChange={() => setGoal(s)}>
                  {s}
                </Chip>
              ))}
            </div>
          </div>
        )}
        {create.isPending && (
          <p role="status" className="m-0 flex items-center gap-2 text-sm text-fg-2">
            <Spinner size={16} label="" />
            {copy.drafting}
          </p>
        )}
        {create.isError && incomplete && (
          <Banner tone="warn" action={<LinkButton to="/chat">{copy.finishProfile}</LinkButton>}>
            {copy.profileIncomplete}
          </Banner>
        )}
        {create.isError && unverified && <VerifyEmailPrompt />}
        {create.isError && limited && error instanceof ApiError && (
          <Banner tone="warn">{dailyLimitText(error)}</Banner>
        )}
        {create.isError && !handled && <Banner tone="warn">{copy.draftFailed}</Banner>}
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {copy.draft}
          </Button>
          <Link to="/plans" className="text-sm text-muted hover:text-fg">
            {copy.cancel}
          </Link>
        </div>
      </form>
    </div>
  );
}
