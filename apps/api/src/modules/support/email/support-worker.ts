import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type {
  OutboxMessage,
  OutboxSubscription,
} from '../../../shared/infrastructure/outbox/index.js';
import {
  SendSupportEmail,
  type SupportEmailDeps,
  type SupportEmailMessage,
} from '../application/notifications/send-support-email.js';

/** The BullMQ queue the four support emails go through (FR-11). */
export const SUPPORT_QUEUE = 'support';

/** Outbox events this module consumes, routed to its queue by the relay. */
export const supportSubscriptions: readonly OutboxSubscription[] = [
  { event: 'TicketOpened', queue: SUPPORT_QUEUE },
  { event: 'CustomerReplied', queue: SUPPORT_QUEUE },
  { event: 'StaffReplied', queue: SUPPORT_QUEUE },
  { event: 'TicketClosed', queue: SUPPORT_QUEUE },
];

const HANDLED = new Set<string>(supportSubscriptions.map((s) => s.event));

function deliveredOf(job: Job): string[] {
  const p = job.progress as { delivered?: unknown } | number | undefined;
  return typeof p === 'object' && Array.isArray(p.delivered)
    ? p.delivered.filter((d): d is string => typeof d === 'string')
    : [];
}

export interface SupportWorkerDeps extends SupportEmailDeps {
  connection: Redis;
  prefix?: string;
}

/**
 * FR-11, NFR-4: sends the ticket emails. A failed send fails the job so the relay's job options
 * (5 tries, exponential backoff) retry it; the job id is the event id, and recipients already
 * emailed are skipped on a retry. A failure never reaches the user action: it already committed.
 */
export function createSupportEmailWorker(deps: SupportWorkerDeps): Worker {
  const handler = new SendSupportEmail(deps);
  const worker = new Worker<OutboxMessage>(
    SUPPORT_QUEUE,
    async (job: Job<OutboxMessage>) => {
      if (!HANDLED.has(job.data.type)) return;
      await handler.execute(job.data as SupportEmailMessage, {
        delivered: deliveredOf(job),
        save: (delivered) => job.updateProgress({ delivered: [...delivered] }),
      });
    },
    { connection: deps.connection, ...(deps.prefix ? { prefix: deps.prefix } : {}) },
  );
  worker.on('failed', (job, err) =>
    deps.logger.warn({ err, jobId: job?.id, attempts: job?.attemptsMade }, 'support email failed'),
  );
  return worker;
}

/** support's BullMQ workers, started by worker-registry.ts. */
export function registerSupportWorkers(deps: SupportWorkerDeps): Worker[] {
  return [createSupportEmailWorker(deps)];
}
