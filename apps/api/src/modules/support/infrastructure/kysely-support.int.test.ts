import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { KyselyOutbox } from '../../../shared/infrastructure/outbox/index.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { assertUnderOpenLimit } from '../domain/rules.js';
import { assertVersion, openTicket, outboxEvents, take, type Ticket } from '../domain/ticket.js';
import { BUSINESS_A, members, NOW, openInput } from '../test/factories.js';
import { resetSupportWorld } from '../test/mysql-support.js';
import { describeTicketRepositoryContract, openAt } from '../test/ticket-repository-contract.js';
import { KyselySupportStore } from './kysely-support.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const ids = new Uuid7Generator();
const store = new KyselySupportStore(db, new KyselyOutbox(ids, new FixedClock(NOW)));

afterAll(async () => {
  await db.destroy();
});

async function outboxRows() {
  const rows = await db
    .selectFrom('outbox')
    .select(['type', 'payload'])
    .orderBy('id', 'asc')
    .execute();
  return rows.map((r) => ({
    type: r.type,
    payload: typeof r.payload === 'string' ? (JSON.parse(r.payload) as unknown) : r.payload,
  }));
}

describeTicketRepositoryContract('KyselySupportStore (MySQL)', async () => {
  await resetSupportWorld(db);
  return { store, published: outboxRows };
});

/** The FR-2 create path: lock the Business's open Tickets, check the limit, insert, publish. */
function createWithinLimit(at: Date): Promise<Ticket> {
  return store.run(async (tx) => {
    assertUnderOpenLimit(await tx.tickets.lockOpenTicketsOfBusiness(BUSINESS_A));
    const opened = openTicket(openInput({ id: ids.next() }), { now: at, ids });
    const ticket = await tx.tickets.create(opened);
    for (const e of outboxEvents(ticket, opened.events)) await tx.events.publish(e.type, e.payload);
    return ticket;
  });
}

describe('support on MySQL: concurrency', () => {
  beforeEach(async () => {
    await resetSupportWorld(db);
  });

  test('FR-8: two Staff take the same Ticket at version 0; one wins, the other gets VERSION_CONFLICT', async () => {
    const t = await openAt(store, new Date(NOW.getTime() - 60_000));
    let arrived = 0;
    let release: () => void = () => undefined;
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    const takeAs = (staffId: string) =>
      store.run(async (tx) => {
        const current = await tx.tickets.findByNumber(t.number);
        if (!current) throw new Error('missing');
        assertVersion(current, 0);
        arrived += 1;
        if (arrived === 2) release();
        await bothRead;
        await tx.tickets.saveChange(take(current, { staffId }, { now: NOW, ids }));
        return staffId;
      });

    const results = await Promise.allSettled([
      takeAs(members.staff1.id),
      takeAs(members.staff2.id),
    ]);
    const won = results.filter(
      (r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled',
    );
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0]?.reason).toMatchObject({ code: 'VERSION_CONFLICT' });

    const after = await store.read.findByNumber(t.number);
    expect(after?.version).toBe(1);
    expect(after?.assigneeId).toBe(won[0]?.value);
    const events = (await store.read.messages(t.id)).filter((m) => m.event?.type === 'taken');
    expect(events).toHaveLength(1);
  });

  test('FR-2: three concurrent creates with 3 open → 2 created, 1 OPEN_TICKET_LIMIT', async () => {
    for (let i = 0; i < 3; i += 1)
      await createWithinLimit(new Date(NOW.getTime() - (10 - i) * 60_000));
    const results = await Promise.allSettled([
      createWithinLimit(NOW),
      createWithinLimit(NOW),
      createWithinLimit(NOW),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'OPEN_TICKET_LIMIT' });
    expect(await store.read.countOpenOfBusiness(BUSINESS_A)).toBe(5);
    expect((await outboxRows()).filter((r) => r.type === 'TicketOpened')).toHaveLength(5);
  });

  test('FR-2: concurrent creates on a Business with none open both succeed (a deadlock is retried)', async () => {
    const results = await Promise.allSettled([createWithinLimit(NOW), createWithinLimit(NOW)]);
    const created = results.filter(
      (r): r is PromiseFulfilledResult<Ticket> => r.status === 'fulfilled',
    );
    expect(created).toHaveLength(2);
    expect(await store.read.countOpenOfBusiness(BUSINESS_A)).toBe(2);
    expect(new Set(created.map((r) => r.value.number)).size).toBe(2);
  });
});
