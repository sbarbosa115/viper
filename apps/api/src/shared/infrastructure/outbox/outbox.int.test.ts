import { randomUUID } from 'node:crypto';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { sql } from 'kysely';
import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { createDatabase } from '../db/database.js';
import { FixedClock } from '../time/system-clock.js';
import { SequentialIdGenerator } from '../time/uuid7.js';
import type { OutboxMessage, OutboxSubscription } from './events.js';
import { KyselyOutbox } from './outbox.js';
import { createOutboxRelayWorker, OutboxRelay, type EventQueue } from './relay.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const logger = pino({ level: 'silent' });
const clock = new FixedClock(new Date('2026-11-19T10:00:00.000Z'));
const opened: { close(): Promise<void> }[] = [];

let prefix: string;
/** Sequential ids that remember the last one handed out. */
class RecordingIds extends SequentialIdGenerator {
  last = '';
  override next(): string {
    this.last = super.next();
    return this.last;
  }
}

let ids: RecordingIds;
let outbox: KyselyOutbox;

const subscriptions: OutboxSubscription[] = [
  { event: 'RunCompleted', queue: 'email' },
  { event: 'RunCompleted', queue: 'analytics' },
  { event: 'MemberEmailVerified', queue: 'billing' },
];

function queue(name: string): Queue<OutboxMessage> {
  const q = new Queue<OutboxMessage>(name, { connection, prefix });
  opened.push(q);
  return q;
}

function relay(openQueue: (name: string) => EventQueue = queue): OutboxRelay {
  const r = new OutboxRelay({ db, clock, logger, subscriptions, openQueue });
  opened.push(r);
  return r;
}

const runCompleted = {
  runId: '00000000-0000-7000-8000-0000000000aa',
  businessId: '00000000-0000-7000-8000-0000000000bb',
  planId: '00000000-0000-7000-8000-0000000000cc',
  startedByStaffId: null,
};

async function addCommitted(): Promise<void> {
  await db.transaction().execute((trx) => outbox.add(trx, 'RunCompleted', runCompleted));
}

beforeEach(async () => {
  await sql`TRUNCATE TABLE outbox`.execute(db);
  prefix = `test-${randomUUID()}`;
  ids = new RecordingIds();
  outbox = new KyselyOutbox(ids, clock);
});

afterAll(async () => {
  await Promise.all(opened.map((o) => o.close()));
  await db.destroy();
  connection.disconnect();
});

describe('outbox: Outbox.add writes in the caller transaction', () => {
  test('a committed transaction keeps the event', async () => {
    await addCommitted();
    const rows = await db.selectFrom('outbox').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'RunCompleted', payload: runCompleted, attempts: 0 });
    expect(rows[0]?.dispatched_at).toBeNull();
  });

  test('a rolled-back transaction leaves no event', async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await outbox.add(trx, 'MemberEmailVerified', { memberId: 'm', businessId: 'b' });
        throw new Error('use case failed');
      }),
    ).rejects.toThrow('use case failed');
    expect(await db.selectFrom('outbox').selectAll().execute()).toHaveLength(0);
  });
});

describe('outbox: relay to BullMQ', () => {
  test('dispatches to every subscribed queue with the event id as job id, once', async () => {
    await addCommitted();
    const r = relay();

    expect(await r.relayOnce()).toBe(1);
    expect(await r.relayOnce()).toBe(0);

    for (const name of ['email', 'analytics']) {
      const jobs = await queue(name).getJobs(['waiting']);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.id).toBe(ids.last);
      expect(jobs[0]?.name).toBe('RunCompleted');
      expect(jobs[0]?.data).toEqual({
        eventId: ids.last,
        type: 'RunCompleted',
        payload: runCompleted,
        occurredAt: '2026-11-19T10:00:00.000Z',
      });
    }
    expect(await queue('billing').getJobCounts('waiting')).toEqual({ waiting: 0 });
    const row = await db.selectFrom('outbox').selectAll().executeTakeFirstOrThrow();
    expect(row.dispatched_at).toEqual(clock.now());
    expect(row.attempts).toBe(1);
  });

  test('a failed dispatch stays pending, records the error and goes out on the next tick', async () => {
    await addCommitted();
    let failNext = true;
    const flaky = (name: string): EventQueue => {
      const real = queue(name);
      return {
        add: (jobName, data, opts) => {
          if (failNext) {
            failNext = false;
            return Promise.reject(new Error('valkey unavailable'));
          }
          return real.add(jobName, data, opts);
        },
        close: () => real.close(),
      };
    };
    const r = relay(flaky);

    expect(await r.relayOnce()).toBe(0);
    const pending = await db.selectFrom('outbox').selectAll().executeTakeFirstOrThrow();
    expect(pending).toMatchObject({
      dispatched_at: null,
      attempts: 1,
      last_error: 'valkey unavailable',
    });

    expect(await r.relayOnce()).toBe(1);
    expect(await queue('email').getJobCounts('waiting')).toEqual({ waiting: 1 });
    expect(await queue('analytics').getJobCounts('waiting')).toEqual({ waiting: 1 });
    const done = await db.selectFrom('outbox').selectAll().executeTakeFirstOrThrow();
    expect(done).toMatchObject({ attempts: 2, last_error: null });
  });

  test('re-relaying an event already queued (crash before commit) does not duplicate the job', async () => {
    await addCommitted();
    const eventId = ids.last;
    await queue('email').add('RunCompleted', {} as OutboxMessage, { jobId: eventId });

    expect(await relay().relayOnce()).toBe(1);
    expect(await queue('email').getJobCounts('waiting')).toEqual({ waiting: 1 });
  });

  test('events without subscribers are marked dispatched', async () => {
    await db
      .transaction()
      .execute((trx) => outbox.add(trx, 'RunRequested', { runId: 'r', businessId: 'b' }));
    expect(await relay().relayOnce()).toBe(1);
  });

  test('the relay worker job delivers committed events to a consumer', async () => {
    const relayWorker = createOutboxRelayWorker({
      db,
      connection,
      clock,
      logger,
      subscriptions,
      everyMs: 100,
      prefix,
    });
    const received = new Promise<Job<OutboxMessage>>((resolve) => {
      const consumer = new Worker<OutboxMessage>(
        'billing',
        (job) => {
          resolve(job);
          return Promise.resolve();
        },
        { connection, prefix },
      );
      opened.push(consumer);
    });

    await db
      .transaction()
      .execute((trx) =>
        outbox.add(trx, 'MemberEmailVerified', { memberId: 'm1', businessId: 'b1' }),
      );

    const job = await received;
    expect(job.data.payload).toEqual({ memberId: 'm1', businessId: 'b1' });
    await relayWorker.close();
  }, 15_000);
});
