import type { AnalyticsTracker } from '../../../shared/application/analytics-tracker.js';
import type { Clock } from '../../../shared/domain/clock.js';
import type { ResearchRun } from '../domain/run.js';
import type { BillingPort, QueueMonitor, ResearchStore, RunQueue } from './ports.js';
import { concludeAttempt, trackRunFinished, type AttemptConclusion } from './run-lifecycle.js';

export interface SweeperDeps {
  store: ResearchStore;
  billing: BillingPort;
  queue: RunQueue;
  monitor: QueueMonitor;
  clock: Clock;
  analytics: AnalyticsTracker;
  logger?: { warn(obj: object, msg: string): void };
}

const BATCH = 50;
/** A due retry or a queued run without a job for this long is queued again (lost job). */
const REQUEUE_AFTER_MS = 60_000;

/**
 * The run sweeper (FR-36, NFR-11), every 30 s: ends attempts whose lease expired as
 * `worker_stopped` and queues the next attempt after the flow's wait (or fails the run when
 * attempts or total time ran out), and re-queues due retries and queued runs whose job was lost.
 */
export class RunSweeper {
  constructor(private readonly deps: SweeperDeps) {}

  async sweep(): Promise<{ stalled: number; requeued: number }> {
    const now = this.deps.clock.now();
    const expired = await this.deps.store.transaction((tx) =>
      tx.attempts.expiredLeases(now, BATCH),
    );
    let stalled = 0;
    for (const attempt of expired) {
      if (await this.endStalled(attempt.runId, attempt.n, now)) stalled += 1;
    }

    const before = new Date(now.getTime() - REQUEUE_AFTER_MS);
    const { due, queued } = await this.deps.store.transaction(async (tx) => ({
      due: await tx.runs.dueRetries(before, BATCH),
      queued: await tx.runs.staleQueued(before, BATCH),
    }));
    for (const run of [...due, ...queued]) {
      await this.deps.queue.enqueue(run.id, { attemptN: run.attempts + 1, delayMs: 0 });
    }
    await this.deps.monitor.recordSweep(now, stalled);
    return { stalled, requeued: due.length + queued.length };
  }

  private async endStalled(runId: string, n: number, now: Date): Promise<boolean> {
    let ended: { run: ResearchRun; conclusion: AttemptConclusion; activeSeconds: number } | null =
      null;
    await this.deps.store.transaction(async (tx) => {
      const attempt = (await tx.attempts.list(runId)).find((a) => a.n === n);
      if (
        attempt?.status !== 'running' ||
        !attempt.leaseExpiresAt ||
        attempt.leaseExpiresAt >= now
      ) {
        return;
      }
      const run = await tx.runs.findForUpdate(runId);
      if (!run) return;
      const lease = run.settings.workerStoppedAfterMinutes * 60_000;
      // The worker was last seen when it last renewed the lease.
      const lastSeen = attempt.leaseExpiresAt.getTime() - lease;
      const activeSeconds = Math.max(0, (lastSeen - attempt.startedAt.getTime()) / 1000);
      if (run.status !== 'running') {
        await tx.attempts.save({
          ...attempt,
          status: 'worker_stopped',
          endedAt: now,
          leaseExpiresAt: null,
        });
        return;
      }
      const handoff = await tx.handoffs.get(runId);
      const conclusion = await concludeAttempt(tx, this.deps, {
        run,
        attempt,
        status: 'worker_stopped',
        error: { code: 'INTERNAL_ERROR', message: 'The worker stopped (lease expired)' },
        activeSeconds,
        handoff: handoff ? { ...handoff, updatedAt: now } : null,
        now,
      });
      ended = { run, conclusion, activeSeconds };
    });
    if (!ended) return false;
    const { run, conclusion, activeSeconds } = ended as {
      run: ResearchRun;
      conclusion: AttemptConclusion;
      activeSeconds: number;
    };
    if (conclusion.retry) await this.deps.queue.enqueue(runId, conclusion.retry);
    const s = run.toSnapshot();
    await this.deps.analytics.track({
      name: 'run_attempt_finished',
      actor: { memberId: s.startedByMemberId, businessId: s.businessId },
      properties: {
        run_id: runId,
        attempt: n,
        outcome: 'worker_stopped',
        step_key:
          (await this.deps.store.transaction((tx) => tx.handoffs.get(runId)))?.stepKey ?? null,
        active_s: Math.round(activeSeconds),
      },
    });
    if (conclusion.finished) await trackRunFinished(this.deps.analytics, run);
    return true;
  }
}
