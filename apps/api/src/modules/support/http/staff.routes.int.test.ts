import { versionConflictError } from '@app/contracts/support';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { buildTestApp } from '../../../../test/build-test-app.js';
import type { Actor } from '../../../shared/domain/actor.js';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { KyselyOutbox } from '../../../shared/infrastructure/outbox/index.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { createStaffSupport } from '../application/staff/index.js';
import { openTicket } from '../domain/index.js';
import { KyselySupportStore } from '../infrastructure/kysely-support.js';
import type { SupportAuditRecord } from '../ports.js';
import { INTERNAL_BUSINESS, members, NOW, openInput } from '../test/factories.js';
import { resetSupportWorld } from '../test/mysql-support.js';
import { staffSupportRoutes } from './staff.routes.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const ids = new Uuid7Generator();
const clock = new FixedClock(NOW);
const store = new KyselySupportStore(db, new KyselyOutbox(ids, clock));
const audit: SupportAuditRecord[] = [];

const staff = (memberId: string): Actor => ({
  memberId,
  businessId: INTERNAL_BUSINESS,
  roles: ['owner', 'staff'],
  emailVerified: true,
});

const uc = createStaffSupport({
  store,
  identity: {
    memberSummaries: (want) =>
      Promise.resolve(Object.values(members).filter((m) => want.includes(m.id))),
    staffMembers: () => Promise.resolve([members.staff1, members.staff2]),
    staffRecipients: () => Promise.resolve([]),
    businessNames: (want) => Promise.resolve(want.map((id) => ({ id, name: 'Sweet Supply' }))),
  },
  research: {
    recentRunsForBusiness: () => Promise.resolve([]),
    runSummaries: () => Promise.resolve([]),
    runForSupport: () => Promise.resolve(null),
  },
  billing: { balanceFor: () => Promise.resolve(80) },
  audit: {
    record: (entry) => {
      audit.push(entry);
      return Promise.resolve();
    },
  },
  analytics: new RecordingAnalyticsTracker(),
  clock,
  ids,
});

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  audit.length = 0;
  await resetSupportWorld(db);
  await store.run(async (tx) => {
    await tx.tickets.create(openTicket(openInput({ id: ids.next() }), { now: NOW, ids }));
  });
});

describe('FR-8 on MySQL: two Staff take the same Ticket at the same version', () => {
  test('one succeeds (version 1), the other gets 409 with the Ticket assigned to the first', async () => {
    const app = await buildTestApp({
      modules: [{ name: 'support', register: (a) => staffSupportRoutes(uc)(a) }],
      actor: staff(members.staff1.id),
    });
    const [a, b] = await Promise.allSettled([
      uc.take(staff(members.staff1.id), 1001, 0),
      uc.take(staff(members.staff2.id), 1001, 0),
    ]);
    const outcomes = [a, b];
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const winner = outcomes.findIndex((o) => o.status === 'fulfilled');
    const loser = outcomes[1 - winner];
    expect(loser).toMatchObject({ status: 'rejected', reason: { code: 'VERSION_CONFLICT' } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/staff/support/tickets/1001/take',
      payload: { version: 0 },
    });
    expect(res.statusCode).toBe(409);
    const ticket = versionConflictError.parse(res.json()).error.details.ticket;
    expect(ticket).toMatchObject({ version: 1, status: 'in_progress' });
    expect(ticket.assignee?.id).toBe([members.staff1.id, members.staff2.id][winner]);
    expect(audit.map((e) => e.action)).toEqual(['support.taken']);
  });
});

describe('FR-9 on MySQL: reply with close publishes one TicketClosed in the transaction', () => {
  test('the outbox holds a single TicketClosed carrying the reply', async () => {
    await uc.reply(staff(members.staff1.id), 1001, { message: 'Done.', then: 'close' });
    const rows = await db.selectFrom('outbox').select('type').execute();
    expect(rows.map((r) => r.type)).toEqual(['TicketClosed']);
    expect(audit.map((e) => e.action)).toEqual(['support.closed']);
  });

  test('the first view per day writes a view row once', async () => {
    const actor = staff(members.staff1.id);
    await uc.getTicket(actor, 1001);
    await uc.getTicket(actor, 1001);
    expect(audit.map((e) => e.action)).toEqual(['support.ticket_viewed']);
  });
});
