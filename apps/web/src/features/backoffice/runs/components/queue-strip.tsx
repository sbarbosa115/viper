import { Banner } from '../../../../shared/ui';
import { useQueueHealth } from '../api/hooks';
import { copy, fill } from '../copy';
import { formatAgo } from '../lib/format';

const STALE_AFTER_S = 90;

function Count({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-muted">{label}</span>
      <span className={warn && value > 0 ? 'font-mono font-medium text-warn' : 'font-mono text-fg'}>
        {value}
      </span>
    </span>
  );
}

/** FR-32 queue health strip: counts, sweeper and worker heartbeat. */
export function QueueStrip() {
  const queue = useQueueHealth();
  if (queue.isError) return <Banner tone="warn">{copy.queueFailed}</Banner>;
  if (!queue.data) return null;
  const q = queue.data;
  const now = new Date();
  const workerAlive =
    q.workerLastSeenAt !== null &&
    (now.getTime() - new Date(q.workerLastSeenAt).getTime()) / 1000 <= STALE_AFTER_S;
  return (
    <section
      aria-label={copy.queue}
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-line-strong bg-surface px-4 py-3 text-sm"
    >
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
        {copy.queue}
      </span>
      <Count label={copy.waiting} value={q.waiting} />
      <Count label={copy.active} value={q.active} />
      <Count label={copy.retrying} value={q.retrying} warn />
      <Count label={copy.failed} value={q.failed} warn />
      <Count label={copy.stalled} value={q.stalledFound} warn />
      <span className="text-muted">
        ·{' '}
        {q.sweeperLastRunAt
          ? fill(copy.sweeperRan, { ago: formatAgo(q.sweeperLastRunAt, now) })
          : copy.sweeperNever}
      </span>
      <span className="ml-auto inline-flex items-center gap-2 text-muted">
        {q.workerLastSeenAt
          ? fill(copy.workerSeen, { ago: formatAgo(q.workerLastSeenAt, now) })
          : copy.workerNever}
        <span className={workerAlive ? 'font-mono text-accent' : 'font-mono text-danger'}>
          {workerAlive ? copy.workerOk : copy.workerStale}
        </span>
      </span>
    </section>
  );
}
