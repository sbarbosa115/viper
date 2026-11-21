import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { buildTestApp } from '../../../../test/build-test-app.js';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { KyselyOutbox } from '../../../shared/infrastructure/outbox/index.js';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { createCustomerSupport } from '../application/customer/index.js';
import { KyselySupportStore } from '../infrastructure/kysely-support.js';
import { actors, members, NOW } from '../test/factories.js';
import { resetSupportWorld } from '../test/mysql-support.js';
import { customerSupportRoutes } from './customer.routes.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const ids = new Uuid7Generator();
const clock = new FixedClock(NOW);

afterAll(async () => {
  await db.destroy();
});

describe('FR-2 on MySQL: concurrent creates', () => {
  beforeEach(() => resetSupportWorld(db));

  test('two simultaneous identical submits make one Ticket and one TicketOpened', async () => {
    const analytics = new RecordingAnalyticsTracker();
    const uc = createCustomerSupport({
      store: new KyselySupportStore(db, new KyselyOutbox(ids, clock)),
      identity: {
        memberSummaries: (want) =>
          Promise.resolve(Object.values(members).filter((m) => want.includes(m.id))),
      },
      research: {
        recentRunsForBusiness: () => Promise.resolve([]),
        runForSupport: () => Promise.resolve(null),
        runSummaries: () => Promise.resolve([]),
      },
      billing: { balanceFor: () => Promise.resolve(120) },
      analytics,
      clock,
      ids,
    });
    const app = await buildTestApp({
      modules: [{ name: 'support', register: (a) => customerSupportRoutes(a, uc) }],
      actor: actors.memberA,
    });
    const payload = {
      category: 'run',
      subject: 'Run stopped early',
      message: 'It stopped at the Websites step.',
    };
    const responses = await Promise.all([
      app.inject({ method: 'POST', url: '/api/support/tickets', payload }),
      app.inject({ method: 'POST', url: '/api/support/tickets', payload }),
    ]);

    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(await db.selectFrom('support_tickets').select('id').execute()).toHaveLength(1);
    const outbox = await db.selectFrom('outbox').select('type').execute();
    expect(outbox.map((o) => o.type)).toEqual(['TicketOpened']);
    expect(analytics.events.filter((e) => e.name === 'ticket_opened')).toHaveLength(1);
  });
});
