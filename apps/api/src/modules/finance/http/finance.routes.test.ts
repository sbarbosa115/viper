import { errorResponse } from '@app/contracts/errors';
import {
  addExpensePrice,
  createExpense,
  deleteExpensePrice,
  getBudget,
  getPnl,
  listExpenses,
  listProviderInvoices,
  listProviders,
  providerAlreadyCoveredError,
  financeTestContracts,
  saveBudget,
  saveProviderInvoice,
  deleteProviderInvoice,
  updateExpense,
} from '@app/contracts/finance';
import { describe, expect, test } from 'vitest';

const { runBudgetCheck } = financeTestContracts;
import { InMemoryEmailSender } from '../../../shared/infrastructure/email/in-memory-email-sender.js';
import { buildTestApp } from '../../../../test/build-test-app.js';
import type { Actor } from '../../../shared/domain/actor.js';
import { actorResolverFrom, identityModuleFrom } from '../../identity/index.js';
import { PASSWORD } from '../../identity/test/factories.js';
import { fakeIdentity } from '../../identity/test/fakes.js';
import { assembleFinance } from '../index.js';
import { bill, oneOff, seededExpenses } from '../test/factories.js';
import { fakeWorld, ownerActor, seedNovemberSources, staffActor } from '../test/fakes.js';

const ID = '00000000-0000-4000-8000-00000000f00d';

async function appWith(actor?: Actor) {
  const world = fakeWorld();
  const app = await buildTestApp({
    modules: [assembleFinance(world.ctx).module],
    ...(actor ? { actor } : {}),
  });
  return { app, world };
}

const code = (res: { json(): unknown }) => errorResponse.parse(res.json()).error.code;

const recurring = {
  kind: 'recurring',
  name: 'DigitalOcean App Platform',
  vendor: 'DigitalOcean',
  category: 'hosting',
  amountCents: 4215,
  cadence: 'monthly',
  startsOn: '2026-11-05',
};

const ROUTES = [
  { method: 'GET' as const, url: '/api/staff/finance/expenses' },
  { method: 'POST' as const, url: '/api/staff/finance/expenses', payload: recurring },
  { method: 'PATCH' as const, url: `/api/staff/finance/expenses/${ID}`, payload: { name: 'x' } },
  {
    method: 'POST' as const,
    url: `/api/staff/finance/expenses/${ID}/prices`,
    payload: { effectiveFrom: '2026-12-01', amountCents: 100 },
  },
  { method: 'DELETE' as const, url: `/api/staff/finance/expenses/${ID}/prices/2026-12-01` },
  { method: 'DELETE' as const, url: `/api/staff/finance/expenses/${ID}` },
  { method: 'GET' as const, url: '/api/staff/finance/providers' },
  { method: 'GET' as const, url: '/api/staff/finance/provider-invoices' },
  {
    method: 'PUT' as const,
    url: '/api/staff/finance/provider-invoices/twilio/2026-11',
    payload: { amountCents: 150 },
  },
  { method: 'DELETE' as const, url: '/api/staff/finance/provider-invoices/twilio/2026-11' },
  { method: 'GET' as const, url: '/api/staff/finance/pnl' },
  { method: 'GET' as const, url: '/api/staff/finance/pnl.csv?from=2026-11&to=2026-11' },
  { method: 'GET' as const, url: '/api/staff/finance/budget' },
  {
    method: 'PUT' as const,
    url: '/api/staff/finance/budget',
    payload: { monthlyBudgetCents: 60000 },
  },
];

describe('FR-13: every finance endpoint is Staff only', () => {
  test.each(ROUTES)(
    '$method $url: 401 signed out, 403 for an Owner, nothing written',
    async (route) => {
      const signedOut = await (await appWith()).app.inject(route);
      expect(signedOut.statusCode).toBe(401);
      const { app, world } = await appWith(ownerActor);
      const owner = await app.inject(route);
      expect(owner.statusCode).toBe(403);
      expect(code(owner)).toBe('FORBIDDEN');
      expect(world.audit.entries).toEqual([]);
    },
  );
});

describe('FR-1: GET /api/staff/finance/expenses', () => {
  test("lists bills and the month's One-offs; parses against the contract", async () => {
    const { app, world } = await appWith(staffActor);
    world.store.add(...seededExpenses());
    const res = await app.inject({
      method: 'GET',
      url: '/api/staff/finance/expenses?month=2026-11',
    });
    expect(res.statusCode).toBe(200);
    const body = listExpenses.response.parse(res.json());
    expect(body.items).toHaveLength(7);
    expect(body.totals.fixedRunRate.cents).toBe(13540);
    expect(body.items.find((i) => i.name === 'Apify Starter')?.coversProvider).toEqual({
      key: 'apify',
      name: 'Apify',
    });
  });

  test('includeEnded, kind and category filters; bad values 400; month rules 422', async () => {
    const { app, world } = await appWith(staffActor);
    world.store.add(
      bill('A', 'hosting', 100, '2026-11-01'),
      oneOff('B', 'other', 100, '2026-11-02'),
    );
    const ok = await app.inject({
      method: 'GET',
      url: '/api/staff/finance/expenses?kind=one_off&category=other&includeEnded=true',
    });
    expect(listExpenses.response.parse(ok.json()).items.map((i) => i.name)).toEqual(['B']);
    for (const qs of ['kind=weekly', 'category=food', 'month=2026-13', 'includeEnded=maybe']) {
      const bad = await app.inject({ method: 'GET', url: `/api/staff/finance/expenses?${qs}` });
      expect(bad.statusCode, qs).toBe(400);
    }
    const before = await app.inject({
      method: 'GET',
      url: '/api/staff/finance/expenses?month=2026-10',
    });
    expect([before.statusCode, code(before)]).toEqual([422, 'BEFORE_HISTORY_START']);
    const future = await app.inject({
      method: 'GET',
      url: '/api/staff/finance/expenses?month=2026-12',
    });
    expect([future.statusCode, code(future)]).toEqual([422, 'FUTURE_MONTH']);
  });

  test('empty list', async () => {
    const { app } = await appWith(staffActor);
    const body = listExpenses.response.parse(
      (await app.inject({ method: 'GET', url: '/api/staff/finance/expenses' })).json(),
    );
    expect(body).toEqual({
      month: '2026-11',
      items: [],
      totals: {
        fixedRunRate: { cents: 0, currency: 'usd' },
        chargesInMonth: { cents: 0, currency: 'usd' },
      },
    });
  });
});

describe('FR-2, FR-4: POST /api/staff/finance/expenses', () => {
  test('201 with the Expense', async () => {
    const { app, world } = await appWith(staffActor);
    const res = await app.inject({
      method: 'POST',
      url: '/api/staff/finance/expenses',
      payload: recurring,
    });
    expect(res.statusCode).toBe(201);
    expect(createExpense.response.parse(res.json())).toMatchObject({
      nextChargeOn: '2026-12-05',
      amount: { cents: 4215 },
    });
    expect(world.audit.actions()).toEqual(['expense.created']);
  });

  test('400 field messages: amount, name, link, endsOn before startsOn, future spentOn', async () => {
    const { app } = await appWith(staffActor);
    const cases: [Record<string, unknown>, string][] = [
      [{ ...recurring, amountCents: 0 }, 'amountCents'],
      [{ ...recurring, amountCents: 10_000_001 }, 'amountCents'],
      [{ ...recurring, name: '' }, 'name'],
      [{ ...recurring, link: 'http://example.com' }, 'link'],
      [{ ...recurring, endsOn: '2026-11-04' }, 'endsOn'],
      [{ ...recurring, startsOn: '2027-12-01' }, 'startsOn'],
      [
        {
          kind: 'one_off',
          name: 'x',
          vendor: 'x',
          category: 'other',
          amountCents: 100,
          spentOn: '2026-11-21',
        },
        'spentOn',
      ],
    ];
    for (const [payload, field] of cases) {
      const res = await app.inject({ method: 'POST', url: '/api/staff/finance/expenses', payload });
      expect(res.statusCode, field).toBe(400);
      expect(Object.keys(errorResponse.parse(res.json()).error.fields ?? {}), field).toContain(
        field,
      );
    }
    const future = await app.inject({
      method: 'POST',
      url: '/api/staff/finance/expenses',
      payload: {
        kind: 'one_off',
        name: 'x',
        vendor: 'x',
        category: 'other',
        amountCents: 100,
        spentOn: '2026-11-21',
      },
    });
    expect(errorResponse.parse(future.json()).error.fields).toEqual({
      spentOn: "Date can't be in the future",
    });
  });

  test('404 UNKNOWN_PROVIDER, 409 PROVIDER_ALREADY_COVERED with details, 422 codes', async () => {
    const { app } = await appWith(staffActor);
    const plan = { ...recurring, category: 'data_providers', coversProvider: 'apify' };
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/staff/finance/expenses',
      payload: { ...plan, coversProvider: 'openai' },
    });
    expect([unknown.statusCode, code(unknown)]).toEqual([404, 'UNKNOWN_PROVIDER']);
    const first = createExpense.response.parse(
      (
        await app.inject({ method: 'POST', url: '/api/staff/finance/expenses', payload: plan })
      ).json(),
    );
    const clash = await app.inject({
      method: 'POST',
      url: '/api/staff/finance/expenses',
      payload: plan,
    });
    expect(clash.statusCode).toBe(409);
    expect(providerAlreadyCoveredError.parse(clash.json()).error.details).toEqual({
      expenseId: first.id,
      name: plan.name,
    });
    const category = await app.inject({
      method: 'POST',
      url: '/api/staff/finance/expenses',
      payload: { ...recurring, coversProvider: 'twilio' },
    });
    expect([category.statusCode, code(category)]).toEqual([422, 'COVERS_PROVIDER_CATEGORY']);
    const early = await app.inject({
      method: 'POST',
      url: '/api/staff/finance/expenses',
      payload: { ...recurring, startsOn: '2026-10-31' },
    });
    expect([early.statusCode, code(early)]).toEqual([422, 'BEFORE_HISTORY_START']);
  });
});

describe('FR-3: PATCH, prices and DELETE', () => {
  async function withBill() {
    const ctx = await appWith(staffActor);
    const b = bill('Resend', 'email', 2000, '2026-11-18', { id: ID });
    ctx.world.store.add(b);
    return ctx;
  }

  test('PATCH 200; strict body 400; unknown id 404', async () => {
    const { app } = await withBill();
    const ok = await app.inject({
      method: 'PATCH',
      url: `/api/staff/finance/expenses/${ID}`,
      payload: { category: 'software_tools' },
    });
    expect(ok.statusCode).toBe(200);
    expect(updateExpense.response.parse(ok.json()).category).toBe('software_tools');
    for (const payload of [{}, { color: 'red' }, { amountCents: 100 }, { endsOn: '2026-11-01' }]) {
      const bad = await app.inject({
        method: 'PATCH',
        url: `/api/staff/finance/expenses/${ID}`,
        payload,
      });
      expect(bad.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/staff/finance/expenses/00000000-0000-4000-8000-000000000999',
      payload: { name: 'x' },
    });
    expect([missing.statusCode, code(missing)]).toEqual([404, 'NOT_FOUND']);
    const badId = await app.inject({
      method: 'PATCH',
      url: '/api/staff/finance/expenses/nope',
      payload: { name: 'x' },
    });
    expect(badId.statusCode).toBe(400);
  });

  test('POST prices 201; 422 before start; 409 for a One-off; DELETE price 200 / 409 / 404', async () => {
    const { app, world } = await withBill();
    const added = await app.inject({
      method: 'POST',
      url: `/api/staff/finance/expenses/${ID}/prices`,
      payload: { effectiveFrom: '2026-12-18', amountCents: 2500 },
    });
    expect(added.statusCode).toBe(201);
    expect(addExpensePrice.response.parse(added.json()).versions).toHaveLength(2);
    const early = await app.inject({
      method: 'POST',
      url: `/api/staff/finance/expenses/${ID}/prices`,
      payload: { effectiveFrom: '2026-11-01', amountCents: 2500 },
    });
    expect([early.statusCode, code(early)]).toEqual([422, 'EFFECTIVE_BEFORE_START']);
    const o = oneOff('X', 'other', 100, '2026-11-02');
    world.store.add(o);
    const notRecurring = await app.inject({
      method: 'POST',
      url: `/api/staff/finance/expenses/${o.id}/prices`,
      payload: { effectiveFrom: '2026-11-15', amountCents: 2500 },
    });
    expect([notRecurring.statusCode, code(notRecurring)]).toEqual([409, 'NOT_RECURRING']);

    const first = await app.inject({
      method: 'DELETE',
      url: `/api/staff/finance/expenses/${ID}/prices/2026-11-18`,
    });
    expect([first.statusCode, code(first)]).toEqual([409, 'FIRST_VERSION']);
    const none = await app.inject({
      method: 'DELETE',
      url: `/api/staff/finance/expenses/${ID}/prices/2026-12-01`,
    });
    expect(none.statusCode).toBe(404);
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/staff/finance/expenses/${ID}/prices/2026-12-18`,
    });
    expect(removed.statusCode).toBe(200);
    expect(deleteExpensePrice.response.parse(removed.json()).versions).toHaveLength(1);
    expect(world.audit.actions()).toEqual(['expense.price_changed', 'expense.price_changed']);
  });

  test('DELETE 409 HAS_CHARGES for a charged bill, 204 for a One-off, then 404', async () => {
    const { app, world } = await withBill();
    const charged = await app.inject({
      method: 'DELETE',
      url: `/api/staff/finance/expenses/${ID}`,
    });
    expect([charged.statusCode, code(charged)]).toEqual([409, 'HAS_CHARGES']);
    const o = oneOff('X', 'other', 100, '2026-11-02');
    world.store.add(o);
    const gone = await app.inject({ method: 'DELETE', url: `/api/staff/finance/expenses/${o.id}` });
    expect(gone.statusCode).toBe(204);
    expect(gone.body).toBe('');
    const again = await app.inject({
      method: 'DELETE',
      url: `/api/staff/finance/expenses/${o.id}`,
    });
    expect(again.statusCode).toBe(404);
    expect(world.audit.actions()).toEqual(['expense.deleted']);
  });
});

describe('FR-6, FR-8: providers and Provider invoices', () => {
  test('GET providers', async () => {
    const { app } = await appWith(staffActor);
    const body = listProviders.response.parse(
      (await app.inject({ method: 'GET', url: '/api/staff/finance/providers' })).json(),
    );
    expect(body.items.map((p) => p.key)).toContain('google-maps-platform');
  });

  test('GET, PUT, DELETE invoices with their codes', async () => {
    const { app, world } = await appWith(staffActor);
    world.tools.add('Google Maps Platform', 12_750_000);
    const put = await app.inject({
      method: 'PUT',
      url: '/api/staff/finance/provider-invoices/google-maps-platform/2026-11',
      payload: { amountCents: 1720 },
    });
    expect(put.statusCode).toBe(200);
    expect(saveProviderInvoice.response.parse(put.json())).toMatchObject({
      gapPct: 34.9,
      flagged: true,
    });
    const list = listProviderInvoices.response.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/staff/finance/provider-invoices?month=2026-11',
        })
      ).json(),
    );
    expect(list.flaggedCount).toBe(1);
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/staff/finance/provider-invoices/google-maps-platform/2026-11',
    });
    expect(deleteProviderInvoice.response.parse(del.json()).counted.source).toBe('estimate');
    const noInvoice = await app.inject({
      method: 'DELETE',
      url: '/api/staff/finance/provider-invoices/google-maps-platform/2026-11',
    });
    expect([noInvoice.statusCode, code(noInvoice)]).toEqual([404, 'NO_INVOICE']);
    const unknown = await app.inject({
      method: 'PUT',
      url: '/api/staff/finance/provider-invoices/openai/2026-11',
      payload: { amountCents: 1 },
    });
    expect([unknown.statusCode, code(unknown)]).toEqual([404, 'UNKNOWN_PROVIDER']);
    const future = await app.inject({
      method: 'PUT',
      url: '/api/staff/finance/provider-invoices/twilio/2026-12',
      payload: { amountCents: 1 },
    });
    expect([future.statusCode, code(future)]).toEqual([422, 'FUTURE_MONTH']);
    const before = await app.inject({
      method: 'GET',
      url: '/api/staff/finance/provider-invoices?month=2026-10',
    });
    expect([before.statusCode, code(before)]).toEqual([422, 'BEFORE_HISTORY_START']);
    for (const payload of [
      { amountCents: -1 },
      { amountCents: 10_000_001 },
      { amountCents: 1, note: 'x'.repeat(201) },
      {},
    ]) {
      const bad = await app.inject({
        method: 'PUT',
        url: '/api/staff/finance/provider-invoices/twilio/2026-11',
        payload,
      });
      expect(bad.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const badKey = await app.inject({
      method: 'PUT',
      url: '/api/staff/finance/provider-invoices/Not%20A%20Key/2026-11',
      payload: { amountCents: 1 },
    });
    expect(badKey.statusCode).toBe(400);
  });
});

describe('FR-9, FR-10, FR-11: P&L, CSV and Budget', () => {
  test('GET pnl: the seeded November figures parse against the contract', async () => {
    const { app, world } = await appWith(staffActor);
    world.store.add(...seededExpenses());
    seedNovemberSources(world);
    for (const [provider, amountCents] of [
      ['Anthropic', 4410],
      ['Google Maps Platform', 1720],
      ['ZeroBounce', 480],
    ] as const) {
      world.store.invoices.set(`${provider}|2026-11`, {
        provider,
        month: '2026-11',
        amountCents,
        note: null,
        enteredAt: new Date('2026-11-19T10:00:00Z'),
        enteredByMemberId: staffActor.memberId,
      });
    }
    const res = await app.inject({ method: 'GET', url: '/api/staff/finance/pnl?month=2026-11' });
    expect(res.statusCode).toBe(200);
    const body = getPnl.response.parse(res.json());
    expect([body.revenue.net.cents, body.totalExpenses.cents, body.netProfit.cents]).toEqual([
      19700, 52275, -32575,
    ]);
    expect(body.trend).toHaveLength(12);
    const before = await app.inject({ method: 'GET', url: '/api/staff/finance/pnl?month=2026-10' });
    expect([before.statusCode, code(before)]).toEqual([422, 'BEFORE_HISTORY_START']);
    const future = await app.inject({ method: 'GET', url: '/api/staff/finance/pnl?month=2026-12' });
    expect([future.statusCode, code(future)]).toEqual([422, 'FUTURE_MONTH']);
  });

  test('GET pnl.csv: headers, BOM; from after to and more than 24 months are 400', async () => {
    const { app } = await appWith(staffActor);
    const res = await app.inject({
      method: 'GET',
      url: '/api/staff/finance/pnl.csv?from=2026-11&to=2026-11',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="llyner-leads-pnl-2026-11-to-2026-11.csv"',
    );
    expect(res.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(res.body).toContain('2026-11,net,,Net profit,,0.00');
    for (const qs of [
      'from=2026-12&to=2026-11',
      'from=2026-11&to=2028-11',
      'from=2026-11',
      'from=11-2026&to=2026-11',
    ]) {
      const bad = await app.inject({ method: 'GET', url: `/api/staff/finance/pnl.csv?${qs}` });
      expect(bad.statusCode, qs).toBe(400);
    }
    const future = await app.inject({
      method: 'GET',
      url: '/api/staff/finance/pnl.csv?from=2026-11&to=2026-12',
    });
    expect([future.statusCode, code(future)]).toEqual([422, 'FUTURE_MONTH']);
  });

  test('GET and PUT budget; bad amounts 400', async () => {
    const { app, world } = await appWith(staffActor);
    expect(
      getBudget.response.parse(
        (await app.inject({ method: 'GET', url: '/api/staff/finance/budget' })).json(),
      ).updatedBy,
    ).toBeNull();
    const put = await app.inject({
      method: 'PUT',
      url: '/api/staff/finance/budget',
      payload: { monthlyBudgetCents: 60000 },
    });
    expect(put.statusCode).toBe(200);
    expect(saveBudget.response.parse(put.json()).monthlyBudget.cents).toBe(60000);
    for (const payload of [
      { monthlyBudgetCents: -1 },
      { monthlyBudgetCents: 10_000_001 },
      { monthlyBudgetCents: 1.5 },
      {},
    ]) {
      const bad = await app.inject({ method: 'PUT', url: '/api/staff/finance/budget', payload });
      expect(bad.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(world.audit.actions()).toEqual(['budget.changed']);
  });
});

describe('FR-12 / AJ-4 support: POST /api/test/jobs/budget-check', () => {
  async function hookApp(testHooks: boolean) {
    const world = fakeWorld();
    world.store.add(oneOff('Legal review', 'legal_admin', 25000, '2026-11-10'));
    const email = new InMemoryEmailSender();
    const app = await buildTestApp({
      modules: [
        assembleFinance(world.ctx, {
          email,
          appUrl: 'http://localhost:5173',
          logger: { info: () => undefined, warn: () => undefined },
          testHooks,
        }).module,
      ],
    });
    return { app, world, email };
  }

  test('is not registered without test hooks', async () => {
    const { app, email } = await hookApp(false);
    const res = await app.inject({ method: 'POST', url: '/api/test/jobs/budget-check' });
    expect(res.statusCode).toBe(404);
    expect(email.sent).toEqual([]);
  });

  test('runs the check now and answers with the thresholds sent', async () => {
    const { app, world, email } = await hookApp(true);
    const first = await app.inject({ method: 'POST', url: '/api/test/jobs/budget-check' });
    expect(runBudgetCheck.response.parse(first.json())).toEqual({ sent: [80] });
    const second = await app.inject({ method: 'POST', url: '/api/test/jobs/budget-check' });
    expect(second.json()).toEqual({ sent: [] });
    // The email goes through the outbox (the events worker sends it).
    expect(world.store.events).toEqual([
      { type: 'BudgetAlertRecorded', payload: { month: '2026-11', threshold: 80 } },
    ]);
    expect(email.sent).toEqual([]);
  });

  test('{ reset: true } forgets the month alerts first', async () => {
    const { app, world } = await hookApp(true);
    await app.inject({ method: 'POST', url: '/api/test/jobs/budget-check' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/test/jobs/budget-check',
      payload: { reset: true },
    });
    expect(res.json()).toEqual({ sent: [80] });
    expect(world.store.events).toHaveLength(2);
  });
});

describe('FR-13, NFR-2: a half session (Staff, two-factor not passed) gets 403', () => {
  test.each(ROUTES)('$method $url', async (route) => {
    const identity = fakeIdentity();
    const world = fakeWorld();
    const app = await buildTestApp({
      modules: [identityModuleFrom(identity, { secure: false }), assembleFinance(world.ctx).module],
      deps: { resolveActor: actorResolverFrom(identity) },
    });
    const headers = { origin: 'http://localhost:5173' };
    const email = 'half@example.com';
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      headers,
      payload: { businessName: 'Half Co', name: 'Hal', email, password: PASSWORD },
    });
    expect(signup.statusCode).toBe(201);
    await identity.uow.run(async (r) => {
      const m = await r.members.findByEmail(email);
      m?.grantStaff();
      if (m) await r.members.save(m);
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers,
      payload: { email, password: PASSWORD },
    });
    const sid = login.cookies.find((c) => c.name === 'sid')?.value ?? '';
    expect(sid).not.toBe('');
    const res = await app.inject({ ...route, headers: { ...headers, cookie: `sid=${sid}` } });
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe('TWO_FACTOR_REQUIRED');
    expect(world.audit.entries).toEqual([]);
  });
});
