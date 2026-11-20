import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { sql } from 'kysely';
import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import type { OutboxMessage } from '../../../shared/infrastructure/outbox/index.js';
import { BILLING_QUEUE, billingSubscriptions, registerBillingWorkers } from '../index.js';
import { FixedTrialCredits } from './in-memory-billing.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const BUSINESS = '00000000-0000-7000-8000-00000000b001';
const prefix = `test-${randomUUID()}`;
const closers: { close(): Promise<void> }[] = [];

beforeEach(async () => {
  await sql`TRUNCATE TABLE credit_ledger`.execute(db);
  await sql`TRUNCATE TABLE credit_wallets`.execute(db);
});

afterAll(async () => {
  for (const c of closers) await c.close();
  await db.destroy();
  connection.disconnect();
});

describe('FR-11: trial credits consumer (BullMQ)', () => {
  test('subscribes to MemberEmailVerified on the billing queue', () => {
    expect(billingSubscriptions).toEqual([{ event: 'MemberEmailVerified', queue: BILLING_QUEUE }]);
  });

  test('two deliveries of the same verification grant the trial credits once', async () => {
    const [worker] = registerBillingWorkers({
      db,
      connection,
      logger: pino({ level: 'silent' }),
      trialCredits: new FixedTrialCredits(50),
      prefix,
    });
    if (worker) closers.push(worker);
    const queue = new Queue<OutboxMessage>(BILLING_QUEUE, { connection, prefix });
    const events = new QueueEvents(BILLING_QUEUE, { connection, prefix });
    closers.push(queue, events);
    await events.waitUntilReady();

    for (const eventId of ['evt-a', 'evt-b']) {
      const job = await queue.add('MemberEmailVerified', {
        eventId,
        type: 'MemberEmailVerified',
        payload: { memberId: 'm', businessId: BUSINESS },
        occurredAt: '2026-11-19T10:00:00.000Z',
      });
      await job.waitUntilFinished(events, 10_000);
    }

    const grants = await db.selectFrom('credit_ledger').selectAll().execute();
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      type: 'grant',
      credits: 50,
      description: 'Free trial credits',
      idempotency_key: `trial:${BUSINESS}`,
    });
  }, 20_000);
});
