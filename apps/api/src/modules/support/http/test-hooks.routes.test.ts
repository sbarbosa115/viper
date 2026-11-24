import { closeTicketAgo, fillOpenTickets } from '@app/contracts/support';
import { describe, expect, test } from 'vitest';
import { buildTestApp } from '../../../../test/build-test-app.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import { OPEN_TICKET_LIMIT } from '@app/contracts/support';
import { BUSINESS_A, BUSINESS_B, members, NOW, ticketIn } from '../test/factories.js';
import { InMemorySupportStore } from '../test/in-memory-support.js';
import { supportTestRoutes } from './test-hooks.routes.js';

async function hooks(nodeEnv: string) {
  const store = new InMemorySupportStore();
  const app = await buildTestApp({
    modules: [
      {
        name: 'support',
        register: (a) =>
          supportTestRoutes({
            nodeEnv,
            store,
            identity: {
              businessNames: (ids) =>
                Promise.resolve(
                  [{ id: BUSINESS_A, name: 'Sweet Supply' }].filter((b) => ids.includes(b.id)),
                ),
            },
            ownerOf: (id) => Promise.resolve(id === BUSINESS_A ? members.ownerA.id : null),
            clock: new FixedClock(NOW),
            ids: new SequentialIdGenerator(),
          })(a),
      },
    ],
  });
  return { app, store };
}

const closeAgo = { method: 'POST' as const, url: '/api/test/support/close-ago' };
const fillOpen = { method: 'POST' as const, url: '/api/test/support/fill-open' };

describe('AJ-4: POST /api/test/support/close-ago', () => {
  test('back-dates closedAt so the reopen window can pass', async () => {
    const { app, store } = await hooks('test');
    store.tickets.seed(ticketIn('closed', { number: 1001 }));
    const res = await app.inject({ ...closeAgo, payload: { number: 1001, days: 31 } });
    expect(res.statusCode).toBe(200);
    const body = closeTicketAgo.response.parse(res.json());
    expect(body.closedAt).toBe(new Date(NOW.getTime() - 31 * 24 * 3600_000).toISOString());
    expect((await store.read.findByNumber(1001))?.closedAt?.toISOString()).toBe(body.closedAt);
  });

  test('404 for an unknown Ticket, 409 for one that is not closed', async () => {
    const { app, store } = await hooks('test');
    store.tickets.seed(ticketIn('open', { number: 1001 }));
    expect((await app.inject({ ...closeAgo, payload: { number: 1002, days: 1 } })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ ...closeAgo, payload: { number: 1001, days: 1 } })).statusCode).toBe(
      409,
    );
  });
});

describe('AJ-6: POST /api/test/support/fill-open', () => {
  test('creates open Tickets until the Business has count not closed', async () => {
    const { app, store } = await hooks('test');
    store.tickets.seed(ticketIn('open', { number: 1001 }));
    store.tickets.seed(ticketIn('closed', { number: 1002 }));
    const res = await app.inject({
      ...fillOpen,
      payload: { businessId: BUSINESS_A, count: OPEN_TICKET_LIMIT },
    });
    expect(res.statusCode).toBe(200);
    expect(fillOpenTickets.response.parse(res.json()).numbers).toHaveLength(OPEN_TICKET_LIMIT - 1);
    expect(await store.read.countOpenOfBusiness(BUSINESS_A)).toBe(OPEN_TICKET_LIMIT);
    const again = await app.inject({
      ...fillOpen,
      payload: { businessId: BUSINESS_A, count: OPEN_TICKET_LIMIT },
    });
    expect(fillOpenTickets.response.parse(again.json()).numbers).toEqual([]);
  });

  test('404 for an unknown Business; 400 above the limit', async () => {
    const { app } = await hooks('test');
    const unknown = await app.inject({
      ...fillOpen,
      payload: { businessId: BUSINESS_B, count: 2 },
    });
    expect(unknown.statusCode).toBe(404);
    const over = await app.inject({
      ...fillOpen,
      payload: { businessId: BUSINESS_A, count: OPEN_TICKET_LIMIT + 1 },
    });
    expect(over.statusCode).toBe(400);
  });
});

describe('the hooks exist only when NODE_ENV=test', () => {
  test.each(['production', 'development'])('absent in %s', async (env) => {
    const { app } = await hooks(env);
    expect((await app.inject({ ...closeAgo, payload: { number: 1001, days: 1 } })).statusCode).toBe(
      404,
    );
    expect(
      (await app.inject({ ...fillOpen, payload: { businessId: BUSINESS_A, count: 1 } })).statusCode,
    ).toBe(404);
  });
});
