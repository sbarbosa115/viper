import type { Transaction } from 'kysely';
import type { Clock } from '../../domain/clock.js';
import type { IdGenerator } from '../../domain/id-generator.js';
import type { DB } from '../db/schema.js';
import type { OutboxEventType, OutboxEvents } from './events.js';

/**
 * Records an event in the caller's transaction, so it is published if and only if the
 * transaction commits. The relay delivers it to BullMQ queues afterwards.
 */
export interface Outbox {
  add<K extends OutboxEventType>(
    trx: Transaction<DB>,
    type: K,
    payload: OutboxEvents[K],
  ): Promise<void>;
}

export class KyselyOutbox implements Outbox {
  constructor(
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async add<K extends OutboxEventType>(
    trx: Transaction<DB>,
    type: K,
    payload: OutboxEvents[K],
  ): Promise<void> {
    await trx
      .insertInto('outbox')
      .values({
        id: this.ids.next(),
        type,
        payload: JSON.stringify(payload),
        created_at: this.clock.now(),
      })
      .execute();
  }
}

/** Test double: keeps events in memory, ignoring the transaction. */
export class InMemoryOutbox implements Outbox {
  readonly events: { type: OutboxEventType; payload: unknown }[] = [];

  add<K extends OutboxEventType>(
    _trx: Transaction<DB>,
    type: K,
    payload: OutboxEvents[K],
  ): Promise<void> {
    this.events.push({ type, payload });
    return Promise.resolve();
  }
}
