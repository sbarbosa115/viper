import { Queue, Worker, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import type { Clock } from '../../domain/clock.js';
import type { Database } from '../db/database.js';
import type { OutboxEventType, OutboxMessage, OutboxSubscription } from './events.js';

export const OUTBOX_QUEUE = 'outbox';
export const OUTBOX_RELAY_EVERY_MS = 2_000;
const BATCH_SIZE = 100;

/** Default options for jobs the relay creates; FR-22 asks for 5 tries on emails. */
export const defaultEventJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 5_000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

/** The part of a BullMQ queue the relay uses (a seam for tests). */
export interface EventQueue {
  add(name: string, data: OutboxMessage, opts: JobsOptions): Promise<unknown>;
  close(): Promise<void>;
}

export interface OutboxRelayDeps {
  db: Database;
  clock: Clock;
  logger: Pick<Logger, 'warn' | 'debug'>;
  subscriptions: readonly OutboxSubscription[];
  openQueue: (name: string) => EventQueue;
}

/**
 * Moves committed outbox rows to BullMQ, at least once: a row is marked dispatched only after
 * every subscribed queue accepted the job. The job id is the event id, so a re-relay after a
 * crash does not duplicate a job that is still in the queue; consumers stay idempotent anyway.
 */
export class OutboxRelay {
  private readonly queues = new Map<string, EventQueue>();

  constructor(private readonly deps: OutboxRelayDeps) {}

  /** Relays one batch in id (creation) order and returns how many events were dispatched. */
  async relayOnce(): Promise<number> {
    return this.deps.db.transaction().execute(async (trx) => {
      const rows = await trx
        .selectFrom('outbox')
        .select(['id', 'type', 'payload', 'created_at'])
        .where('dispatched_at', 'is', null)
        .orderBy('id')
        .limit(BATCH_SIZE)
        .forUpdate()
        .skipLocked()
        .execute();

      let dispatched = 0;
      for (const row of rows) {
        try {
          await this.dispatch({
            eventId: row.id,
            type: row.type as OutboxEventType,
            payload: row.payload as OutboxMessage['payload'],
            occurredAt: row.created_at.toISOString(),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.deps.logger.warn({ err: error, eventId: row.id }, 'outbox dispatch failed');
          await trx
            .updateTable('outbox')
            .set({ attempts: sql<number>`attempts + 1`, last_error: message.slice(0, 1000) })
            .where('id', '=', row.id)
            .execute();
          // Keep creation order: later events wait for the next tick.
          break;
        }
        await trx
          .updateTable('outbox')
          .set({
            dispatched_at: this.deps.clock.now(),
            attempts: sql<number>`attempts + 1`,
            last_error: null,
          })
          .where('id', '=', row.id)
          .execute();
        dispatched += 1;
      }
      return dispatched;
    });
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
  }

  private async dispatch(message: OutboxMessage): Promise<void> {
    const targets = this.deps.subscriptions.filter((s) => s.event === message.type);
    if (targets.length === 0) {
      this.deps.logger.debug({ type: message.type }, 'outbox event has no subscribers');
    }
    for (const { queue } of targets) {
      await this.queue(queue).add(message.type, message, {
        ...defaultEventJobOptions,
        jobId: message.eventId,
      });
    }
  }

  private queue(name: string): EventQueue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = this.deps.openQueue(name);
      this.queues.set(name, queue);
    }
    return queue;
  }
}

export interface OutboxRelayWorkerDeps {
  db: Database;
  connection: Redis;
  clock: Clock;
  logger: Logger;
  subscriptions: readonly OutboxSubscription[];
  everyMs?: number;
  /** BullMQ key prefix (tests isolate themselves with their own). */
  prefix?: string;
}

/**
 * The relay as a worker job: a BullMQ job scheduler adds a `relay` job to the `outbox` queue
 * every 2 s, and this worker (concurrency 1) runs one relay batch per job.
 */
export function createOutboxRelayWorker(deps: OutboxRelayWorkerDeps): Worker {
  const prefix = deps.prefix ?? 'bull';
  const relay = new OutboxRelay({
    db: deps.db,
    clock: deps.clock,
    logger: deps.logger,
    subscriptions: deps.subscriptions,
    openQueue: (name) => new Queue<OutboxMessage>(name, { connection: deps.connection, prefix }),
  });
  const scheduler = new Queue(OUTBOX_QUEUE, { connection: deps.connection, prefix });
  scheduler
    .upsertJobScheduler(
      'outbox-relay',
      { every: deps.everyMs ?? OUTBOX_RELAY_EVERY_MS },
      { name: 'relay', opts: { removeOnComplete: true, removeOnFail: 100 } },
    )
    .catch((err: unknown) => deps.logger.error({ err }, 'could not schedule the outbox relay'));

  const worker = new Worker(OUTBOX_QUEUE, () => relay.relayOnce(), {
    connection: deps.connection,
    prefix,
    concurrency: 1,
  });
  worker.on('failed', (_job, err) => deps.logger.warn({ err }, 'outbox relay run failed'));
  worker.on('closed', () => {
    void Promise.all([relay.close(), scheduler.close()]);
  });
  return worker;
}
