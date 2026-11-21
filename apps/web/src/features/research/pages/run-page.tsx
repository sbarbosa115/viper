import type { RunSummary } from '@app/contracts/research';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { ApiError } from '../../../shared/api/client';
import { Banner, Button, Dialog, ErrorState, Skeleton } from '../../../shared/ui';
import {
  isActive,
  useCancelRun,
  useRefreshAfterRun,
  usePlanName,
  useResumeRun,
  useRun,
} from '../api/hooks';
import { Checklist } from '../components/checklist';
import { CreditsDialog } from '../components/credits-dialog';
import { copy, failureReasons, fill, genericFailure } from '../copy';
import { formatCostPerLead, formatElapsed, leadsLabel } from '../lib/format';
import { useNow } from '../lib/use-now';

const shortfallSchema = z.object({ available: z.int(), required: z.int() });

const linkButton =
  'inline-flex h-10 items-center justify-center whitespace-nowrap rounded-control px-4 text-sm';
const primaryLink = `${linkButton} bg-accent font-semibold text-accent-ink hover:bg-accent-hover`;
const secondaryLink = `${linkButton} border border-line-control font-medium text-fg hover:bg-surface`;

/** FR-3: opens a ticket with this run attached; `from` carries the app path (basename /app). */
const reportNote = 'Report a problem opens a ticket with this run attached.';

function ReportLink({ runId }: { runId: string }) {
  const { pathname } = useLocation();
  const query = new URLSearchParams({ runId, source: 'run', from: `/app${pathname}` });
  return (
    <Link
      to={`/support/new?${query.toString()}`}
      className="inline-flex h-11 w-full items-center justify-center rounded-control text-sm text-fg-2 hover:text-fg max-md:border max-md:border-line-control md:h-10 md:w-auto md:px-3 md:text-muted md:underline"
    >
      <span className="md:hidden">Something wrong?&nbsp;</span>Report a problem
    </Link>
  );
}

function Heading({ children }: { children: string }) {
  return <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">{children}</h1>;
}

function ActiveHeader({ run, planName }: { run: RunSummary; planName: string }) {
  const now = useNow(true);
  const start = run.startedAt ? new Date(run.startedAt).getTime() : null;
  const time =
    start === null ? copy.waiting : fill(copy.soFar, { time: formatElapsed(now - start) });
  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="viper-pulse size-2.5 rounded-full bg-accent" />
        <Heading>{copy.workingTitle}</Heading>
      </div>
      <p className="m-0 text-sm text-muted">
        {planName ? fill(copy.planMeta, { plan: planName, time }) : time}
      </p>
    </header>
  );
}

function ActiveFooter({ run }: { run: RunSummary }) {
  const cancel = useCancelRun(run.id);
  const [confirming, setConfirming] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  return (
    <>
      <p className="m-0 text-sm text-muted">{copy.emailNote}</p>
      {cancel.isError && <Banner tone="warn">{copy.cancelFailed}</Banner>}
      <div>
        {cancelled ? (
          <p className="m-0 text-sm text-warn">{copy.cancelling}</p>
        ) : (
          <Button variant="danger-text" onClick={() => setConfirming(true)}>
            {copy.cancelRun}
          </Button>
        )}
      </div>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={copy.cancelTitle}
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>{copy.keepGoing}</Button>
            <Button
              variant="primary"
              loading={cancel.isPending}
              onClick={() =>
                cancel.mutate(undefined, {
                  onSuccess: () => setCancelled(true),
                  onSettled: () => setConfirming(false),
                })
              }
            >
              {copy.confirmCancel}
            </Button>
          </>
        }
      >
        <p className="m-0">{copy.cancelBody}</p>
      </Dialog>
    </>
  );
}

function FailedFooter({ run }: { run: RunSummary }) {
  const navigate = useNavigate();
  const resume = useResumeRun(run.id);
  const [shortfall, setShortfall] = useState<
    { available: number; required: number } | null | false
  >(false);
  const [failed, setFailed] = useState(false);

  function retry() {
    setFailed(false);
    resume.mutate(undefined, {
      onError: (error) => {
        if (error instanceof ApiError && error.status === 402) {
          const parsed = shortfallSchema.safeParse(error.details);
          setShortfall(parsed.success ? parsed.data : null);
        } else setFailed(true);
      },
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {failed && <Banner tone="warn">{copy.tryAgainFailed}</Banner>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={resume.isPending} onClick={retry}>
          {copy.tryAgain}
        </Button>
        <Link to={`/plans/${run.planId}`} className={secondaryLink}>
          {copy.backToPlan}
        </Link>
        <ReportLink runId={run.id} />
      </div>
      <p className="m-0 text-sm text-muted">{copy.tryAgainNote}</p>
      <p className="m-0 text-sm text-muted">{reportNote}</p>
      {shortfall !== false && (
        <CreditsDialog
          shortfall={shortfall}
          onClose={() => setShortfall(false)}
          onBuy={() => void navigate('/credits')}
        />
      )}
    </div>
  );
}

function Outcome({ run }: { run: RunSummary }) {
  if (run.status === 'completed') {
    return (
      <>
        <header className="flex flex-col gap-1">
          <Heading>
            {fill(copy.readyTitle, {
              leads: leadsLabel(run.leadsDelivered),
              credits: run.creditsSpent,
              perLead: formatCostPerLead(run.costPerLead),
            })}
          </Heading>
        </header>
        <Checklist steps={run.steps} />
        <div className="flex flex-wrap gap-2">
          <Link to={`/plans/${run.planId}/leads`} className={primaryLink}>
            {copy.seeLeads}
          </Link>
          <Link to={`/plans/${run.planId}`} className={secondaryLink}>
            {copy.backToPlan}
          </Link>
        </div>
      </>
    );
  }
  if (run.status === 'cancelled') {
    return (
      <>
        <header className="flex flex-col gap-1">
          <Heading>{copy.cancelledTitle}</Heading>
          <p className="m-0 text-sm text-muted">
            {fill(copy.cancelledCharged, { n: run.creditsSpent })}
          </p>
        </header>
        <Checklist steps={run.steps} />
        <div className="flex flex-wrap gap-2">
          {run.leadsDelivered > 0 && (
            <Link to={`/plans/${run.planId}/leads`} className={primaryLink}>
              {copy.seeLeads}
            </Link>
          )}
          <Link to={`/plans/${run.planId}`} className={secondaryLink}>
            {copy.backToPlan}
          </Link>
        </div>
      </>
    );
  }
  return (
    <>
      <header className="flex flex-col gap-1">
        <Heading>{copy.failedTitle}</Heading>
        <p className="m-0 text-sm text-fg-2">
          {run.failureReason ? failureReasons[run.failureReason] : genericFailure}
        </p>
        <p className="m-0 text-sm font-semibold text-fg">
          {fill(copy.failedCharged, { n: run.creditsSpent })}
        </p>
      </header>
      <Checklist steps={run.steps} />
      <FailedFooter run={run} />
    </>
  );
}

/** FR-21 / FR-38: the Working screen at /app/runs/:id. */
export function RunPage() {
  const { id = '' } = useParams();
  const run = useRun(id);
  const planName = usePlanName(run.data?.planId);
  const refresh = useRefreshAfterRun();
  const wasActive = useRef(false);
  const active = isActive(run.data);

  useEffect(() => {
    if (active) wasActive.current = true;
    else if (run.data && wasActive.current) {
      wasActive.current = false;
      refresh();
    }
    // `refresh` only wraps the stable query client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, run.data]);

  const notFound = run.error instanceof ApiError && run.error.status === 404;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 md:px-7">
      {run.isPending && (
        <div className="flex flex-col gap-3" role="status" aria-label={copy.loading}>
          <Skeleton className="h-9 w-1/2" />
          <Skeleton className="h-64" />
        </div>
      )}
      {notFound && <ErrorState title={copy.notFound} description={copy.notFoundBody} />}
      {run.isError && !notFound && (
        <ErrorState description={copy.loadFailed} onRetry={() => void run.refetch()} />
      )}
      {run.isSuccess &&
        (active ? (
          <>
            <ActiveHeader run={run.data} planName={planName.data ?? ''} />
            {run.data.takingLonger && <Banner>{copy.takingLonger}</Banner>}
            <Checklist steps={run.data.steps} />
            <ActiveFooter run={run.data} />
          </>
        ) : (
          <Outcome run={run.data} />
        ))}
    </div>
  );
}
