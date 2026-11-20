import type { StaffRunDetail } from '@app/contracts/research';
import { Link, useParams } from 'react-router';
import { ApiError } from '../../../../shared/api/client';
import { Banner, Button, Card, EmptyState, ErrorState, Skeleton } from '../../../../shared/ui';
import { useFlowLimits, useResumeRun, useStaffRun } from '../api/hooks';
import { Attempts } from '../components/attempts';
import { statusNote } from '../components/run-status';
import { Steps } from '../components/steps';
import { copy, fill } from '../copy';
import {
  formatDuration,
  formatFlow,
  formatInt,
  formatStamp,
  formatUsd,
  secondsBetween,
} from '../lib/format';

function hoursMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

function activeSeconds(run: StaffRunDetail): number {
  return run.attempts.reduce((sum, a) => sum + secondsBetween(a.startedAt, a.endedAt), 0);
}

function resumeMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 402) {
      const { available, required } = error.details ?? {};
      return typeof available === 'number' && typeof required === 'number'
        ? fill(copy.resumeNoCredits, { available, required })
        : copy.resumeNoCreditsPlain;
    }
    if (error.code === 'RUN_IN_PROGRESS') return copy.resumeBusy;
    if (error.code === 'RUN_NOT_FAILED') return copy.resumeNotFailed;
  }
  return copy.resumeFailed;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-r border-line px-5 py-4 last:border-r-0">
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{label}</span>
      <span className="font-mono text-[22px] font-medium text-fg">{value}</span>
    </div>
  );
}

function Header({ run }: { run: StaffRunDetail }) {
  const flow = useFlowLimits(run.flow.key);
  const resume = useResumeRun(run.id);
  const settings = flow.data?.version === run.flow.version ? flow.data.runSettings : null;
  const total = secondsBetween(run.startedAt ?? new Date().toISOString(), run.finishedAt);
  const limits = [
    settings &&
      fill(copy.limitsActive, {
        used: Math.round(activeSeconds(run) / 60),
        max: settings.maxActiveMinutes,
      }),
    settings &&
      run.startedAt &&
      fill(copy.limitsTotal, { used: hoursMinutes(total), max: settings.maxTotalHours }),
    fill(copy.limitsAttempts, { n: run.attempt.current, m: run.attempt.max }),
  ].filter(Boolean);
  const note = statusNote(run);
  const failed = run.status === 'failed';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">
            {run.business.name} · {run.planName}
          </h1>
          <p className="m-0 text-sm text-fg-2">
            {copy.statuses[run.status]}
            {note && ` · ${note}`}
            {' · '}
            {fill(copy.startedBy, { who: run.startedBy === 'staff' ? copy.staff : copy.owner })}
            {run.startedAt && ` · ${formatStamp(run.startedAt)}`}
            {' · '}
            {fill(copy.flow, { flow: formatFlow(run.flow.key, run.flow.version) })}
          </p>
          <p className="m-0 font-mono text-xs text-muted">{limits.join(' · ')}</p>
        </div>
        <div className="flex max-w-xs flex-col items-end gap-1">
          <Button
            variant="primary"
            disabled={!failed}
            loading={resume.isPending}
            onClick={() => resume.mutate()}
          >
            {copy.resume}
          </Button>
          <p className="m-0 text-right text-xs text-faint">{copy.resumeNote}</p>
        </div>
      </div>
      {resume.isError && <Banner tone="warn">{resumeMessage(resume.error)}</Banner>}
      {resume.isSuccess && <Banner>{copy.resumeStarted}</Banner>}
      <Card className="grid grid-cols-2 overflow-hidden !p-0 md:grid-cols-4">
        <Fact label={copy.activeTime} value={formatDuration(activeSeconds(run))} />
        <Fact label={copy.credits} value={formatInt(run.creditsSpent)} />
        <Fact label={copy.providerCost} value={formatUsd(run.providerCostMicros)} />
        <Fact label={copy.leads} value={formatInt(run.leadsDelivered)} />
      </Card>
    </div>
  );
}

/** FR-32/FR-36: one run with its attempt timeline, handoff, Steps and Tool calls. */
export function RunDetailPage() {
  const { id = '' } = useParams();
  const query = useStaffRun(id);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-7">
      <Link to="/staff/runs" className="text-sm text-muted hover:text-fg">
        {copy.back}
      </Link>
      {query.isPending && (
        <div className="flex flex-col gap-3" role="status" aria-label="Loading run">
          <Skeleton className="h-10" />
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      )}
      {query.isError &&
        (query.error instanceof ApiError && query.error.status === 404 ? (
          <EmptyState title={copy.notFoundTitle} description={copy.notFoundHint} headingLevel={1} />
        ) : (
          <ErrorState title={copy.detailFailed} onRetry={() => void query.refetch()} />
        ))}
      {query.isSuccess && (
        <>
          <Header run={query.data} />
          <Attempts attempts={query.data.attempts} steps={query.data.steps} />
          <Steps steps={query.data.steps} />
        </>
      )}
    </div>
  );
}
