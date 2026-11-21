import { id as idSchema } from '@app/contracts/common';
import {
  PAGE_PATH_MAX,
  SUBJECT_MAX,
  MESSAGE_MAX,
  category as categorySchema,
  categoryLabels,
  createTicketBody,
  source as sourceSchema,
  type Category,
  type CreateTicketBody,
  type Source,
} from '@app/contracts/support';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { useForm, useWatch, type Resolver } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useCreditBalance, useMe } from '../../../../shared/api/me';
import { Banner, Button, Chip, Field, Input, Textarea, useToast } from '../../../../shared/ui';
import { copy, fill } from '../../copy';
import { useCreateTicket, useSupportRuns } from '../api/hooks';
import { BackLink } from '../components/back-link';
import { RunSelect } from '../components/run-select';
import { Fact, Facts, SidePanel } from '../components/side-panel';
import { applyFieldErrors, isApiError, schemaOptions } from '../lib/form-errors';

interface Values {
  category?: Category;
  subject: string;
  message: string;
  runId?: string;
  source: Source;
  pagePath?: string;
}

const fieldNames = ['category', 'subject', 'message', 'runId'] as const;

/** The query the page was opened with (FR-2, FR-3); anything invalid falls back to "help". */
export function readOrigin(params: URLSearchParams) {
  const runId = idSchema.safeParse(params.get('runId'));
  const source = sourceSchema.safeParse(params.get('source'));
  const category = categorySchema.safeParse(params.get('category'));
  const from = params.get('from');
  const pagePath =
    from && from.startsWith('/app/') && from.length <= PAGE_PATH_MAX ? from : undefined;
  return {
    category: category.success ? category.data : undefined,
    runId: runId.success ? runId.data : undefined,
    source: source.success ? source.data : ('help' as const),
    pagePath,
  };
}

type Problem = 'limit' | 'tooMany' | 'actingAs' | 'failed';

/** FR-2: open a ticket at /app/support/new. */
export function CustomerNewTicketPage() {
  const [params] = useSearchParams();
  const origin = readOrigin(params);
  const navigate = useNavigate();
  const toast = useToast();
  const { me } = useMe();
  const actingAs = me?.actingAs != null;
  const balance = useCreditBalance(true);
  const runs = useSupportRuns();
  const create = useCreateTicket();
  const [problem, setProblem] = useState<{ kind: Problem; limit?: number } | null>(null);

  const form = useForm<Values, unknown, CreateTicketBody>({
    resolver: zodResolver(createTicketBody, schemaOptions) as unknown as Resolver<
      Values,
      unknown,
      CreateTicketBody
    >,
    defaultValues: {
      category: origin.category ?? (origin.runId ? 'run' : undefined),
      subject: '',
      message: '',
      runId: origin.runId,
      source: origin.source,
      ...(origin.pagePath ? { pagePath: origin.pagePath } : {}),
    },
  });
  const { register, control, handleSubmit, setError, setValue, formState } = form;
  const { errors } = formState;
  const category = useWatch({ control, name: 'category' });
  const runId = useWatch({ control, name: 'runId' });
  const message = useWatch({ control, name: 'message' });

  // A run that isn't in the picker (older than 90 days, or not this Business's) is dropped.
  const known = runs.data?.items;
  useEffect(() => {
    if (known && runId && !known.some((r) => r.id === runId)) setValue('runId', undefined);
  }, [known, runId, setValue]);

  const runField = register('runId', { setValueAs: (v: string) => (v === '' ? undefined : v) });

  const onSubmit = (body: CreateTicketBody) => {
    setProblem(null);
    create.mutate(body, {
      onSuccess: (ticket) => {
        toast({ message: fill(copy.sent, { number: ticket.number }) });
        void navigate(`/support/${ticket.number}`);
      },
      onError: (error) => {
        if (isApiError(error, 422, 'OPEN_TICKET_LIMIT')) {
          const limit = error.details?.limit;
          setProblem({ kind: 'limit', ...(typeof limit === 'number' ? { limit } : {}) });
        } else if (isApiError(error, 429)) setProblem({ kind: 'tooMany' });
        else if (isApiError(error, 403, 'NOT_WHILE_ACTING_AS')) setProblem({ kind: 'actingAs' });
        else if (isApiError(error, 404, 'UNKNOWN_RUN')) {
          setError('runId', { type: 'server', message: copy.unknownRun });
        } else if (!applyFieldErrors(error, fieldNames, setError)) setProblem({ kind: 'failed' });
      },
    });
  };

  const submit = handleSubmit(onSubmit);
  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!actingAs && !create.isPending) void submit();
    }
  }

  const banner = actingAs ? { kind: 'actingAs' as const } : problem;
  const messageField = register('message');

  return (
    <div className="flex min-h-full flex-col min-[1000px]:flex-row">
      <form
        noValidate
        aria-label={copy.newTitle}
        onSubmit={(e) => void submit(e)}
        onKeyDown={onKeyDown}
        className="flex min-w-0 flex-[3] flex-col gap-4 px-4 py-4 md:max-w-[760px] md:gap-5 md:px-7 md:py-8"
      >
        <div className="flex items-center gap-1">
          <BackLink />
          <h1 className="m-0 text-xl font-semibold tracking-tight text-fg md:text-3xl">
            {copy.newTitle}
          </h1>
        </div>
        {banner && (
          <Banner
            tone="warn"
            action={
              banner.kind === 'limit' ? (
                <Link to="/support" className="shrink-0 text-sm font-medium text-fg underline">
                  {copy.limitLink}
                </Link>
              ) : undefined
            }
          >
            {banner.kind === 'limit' && fill(copy.limitBanner, { limit: problem?.limit ?? 5 })}
            {banner.kind === 'tooMany' && copy.tooMany}
            {banner.kind === 'actingAs' && copy.actingAsBanner}
            {banner.kind === 'failed' && copy.sendFailed}
          </Banner>
        )}
        <fieldset
          disabled={actingAs}
          className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0 md:gap-5"
        >
          <div role="group" aria-labelledby="category-label" className="flex flex-col gap-2">
            <span id="category-label" className="text-[13px] font-medium text-fg">
              {copy.category}
            </span>
            <div className="flex flex-wrap gap-2">
              {categorySchema.options.map((c) => (
                <Chip
                  key={c}
                  kind="choice"
                  selected={category === c}
                  onSelectedChange={() =>
                    setValue('category', c, { shouldValidate: formState.isSubmitted })
                  }
                >
                  {categoryLabels[c]}
                </Chip>
              ))}
            </div>
            {errors.category && (
              <p role="alert" className="m-0 text-xs text-danger">
                {errors.category.message}
              </p>
            )}
          </div>
          <RunSelect
            runs={runs.data?.items}
            loading={runs.isPending}
            failed={runs.isError}
            disabled={actingAs}
            error={errors.runId?.message}
            value={runId ?? ''}
            name={runField.name}
            onChange={(e) => void runField.onChange(e)}
            onBlur={(e) => void runField.onBlur(e)}
            selectRef={runField.ref}
          />
          <Field label={copy.subject} error={errors.subject?.message}>
            {(p) => (
              <Input
                {...p}
                autoComplete="off"
                maxLength={SUBJECT_MAX + 40}
                {...register('subject')}
              />
            )}
          </Field>
          <Field label={copy.message} error={errors.message?.message}>
            {(p) => (
              <>
                <Textarea {...p} rows={7} {...messageField} />
                <span className="self-end font-mono text-xs text-faint">
                  {fill(copy.counter, { count: message.length, max: MESSAGE_MAX })}
                </span>
              </>
            )}
          </Field>
        </fieldset>
        <p className="m-0 text-[13px] leading-relaxed text-faint min-[1000px]:hidden">
          {copy.attachMobile}
        </p>
        <div className="flex items-center gap-2.5 max-md:mt-auto max-md:flex-col-reverse max-md:items-stretch">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={create.isPending}
            disabled={actingAs}
            className="md:h-10 md:rounded-control md:text-sm"
          >
            {create.isPending ? copy.sending : copy.send}
            <span aria-hidden="true" className="font-mono text-[11px] opacity-70 max-md:hidden">
              ⌘↵
            </span>
          </Button>
          <Link
            to="/support"
            className="px-2.5 py-2.5 text-sm text-muted hover:text-fg max-md:hidden"
          >
            {copy.cancel}
          </Link>
        </div>
      </form>
      <SidePanel title={copy.attachTitle} className="max-[999px]:hidden">
        <Facts>
          {me && <Fact label={copy.attachBusiness}>{me.business.name}</Fact>}
          {me && <Fact label={copy.attachFrom}>{me.member.name}</Fact>}
          {origin.pagePath && (
            <Fact label={copy.attachPage}>
              <span className="font-mono text-[13px]">{origin.pagePath}</span>
            </Fact>
          )}
          {balance !== null && (
            <Fact label={copy.attachBalance}>
              <span className="font-mono">{fill(copy.attachBalanceValue, { count: balance })}</span>
            </Fact>
          )}
        </Facts>
        <p className="m-0 text-[13px] leading-relaxed text-faint">{copy.attachNote}</p>
      </SidePanel>
    </div>
  );
}
