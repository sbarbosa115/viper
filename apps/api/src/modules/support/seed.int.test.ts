import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { createDatabase } from '../../shared/infrastructure/db/database.js';
import { FixedClock } from '../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../shared/infrastructure/time/uuid7.js';
import { KyselySupportStore } from './infrastructure/kysely-support.js';
import { seedSupportDemo } from './seed.js';
import { BUSINESS_A, BUSINESS_B, members, NOW, RUN_ID } from './test/factories.js';
import { resetSupportWorld } from './test/mysql-support.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const ids = new Uuid7Generator();
const store = new KyselySupportStore(db, { add: () => Promise.resolve() });

const deps = {
  db,
  clock: new FixedClock(NOW),
  ids,
  demo: {
    businesses: { sweetSupply: BUSINESS_A, cleanDesk: BUSINESS_B },
    members: {
      owner: members.ownerA.id,
      member: members.memberA.id,
      newOwner: members.ownerB.id,
      staff: members.staff1.id,
    },
  },
};
const ports = {
  research: {
    recentRunsForBusiness: () =>
      Promise.resolve([
        {
          id: RUN_ID,
          planId: 'e0000000-0000-4000-8000-000000000001',
          planName: 'Bakeries near Austin',
          startedAt: NOW.toISOString(),
          status: 'failed' as const,
          stoppedStep: { number: 5, name: 'Websites' },
          creditsCharged: 0,
        },
      ]),
    runForSupport: () => Promise.resolve(null),
    runSummaries: () => Promise.resolve([]),
  },
  billing: { balanceFor: () => Promise.resolve(863) },
};

afterAll(async () => {
  await db.destroy();
});

describe('section 8a: support demo seed', () => {
  beforeEach(() => resetSupportWorld(db));

  test('writes Tickets #1001 to #1005 once, however often it runs, and no outbox events', async () => {
    await seedSupportDemo(deps, ports);
    await seedSupportDemo(deps, ports);

    const rows = await db.selectFrom('support_tickets').selectAll().orderBy('number').execute();
    expect(rows.map((r) => [Number(r.number), r.category, r.status])).toEqual([
      [1001, 'run', 'in_progress'],
      [1002, 'billing', 'waiting_on_customer'],
      [1003, 'run', 'closed'],
      [1004, 'other', 'closed'],
      [1005, 'account', 'open'],
    ]);
    expect(await db.selectFrom('outbox').selectAll().execute()).toEqual([]);
  });

  test('#1001 is linked to the failed run, assigned to Staff, with an Internal note and a Staff reply', async () => {
    await seedSupportDemo(deps, ports);
    const t = await store.read.findByNumber(1001);
    expect(t).toMatchObject({
      runId: RUN_ID,
      assigneeId: members.staff1.id,
      openedByMemberId: members.ownerA.id,
      source: 'run',
    });
    const kinds = (await store.read.messages(t?.id ?? '')).map((m) => m.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['customer_reply', 'event', 'internal_note', 'staff_reply']),
    );
  });

  test('#1002 waits on Jo, #1003 reopens, #1004 does not, #1005 waits unassigned', async () => {
    await seedSupportDemo(deps, ports);
    const day = 24 * 3600_000;
    const [t2, t3, t4, t5] = await Promise.all(
      [1002, 1003, 1004, 1005].map((n) => store.read.findByNumber(n)),
    );
    expect(t2).toMatchObject({
      openedByMemberId: members.memberA.id,
      status: 'waiting_on_customer',
    });
    expect(NOW.getTime() - (t3?.closedAt?.getTime() ?? 0)).toBe(6 * day);
    expect(NOW.getTime() - (t4?.closedAt?.getTime() ?? 0)).toBe(40 * day);
    expect(t3?.closedBy).toBe('staff');
    expect(t5).toMatchObject({
      businessId: BUSINESS_B,
      assigneeId: null,
      openedByMemberId: members.ownerB.id,
    });
    expect(t5?.waitingSince).not.toBeNull();
  });
});
