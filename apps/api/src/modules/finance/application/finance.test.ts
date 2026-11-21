import { describe, expect, test } from 'vitest';
import { assembleFinance } from '../index.js';
import { bill, oneOff, seededExpenses } from '../test/factories.js';
import {
  fakeWorld,
  ownerActor,
  seedNovemberSources,
  STAFF_EMAIL,
  staffActor,
  type FakeWorld,
} from '../test/fakes.js';
import { expensePatch } from '../http/expense-patch.js';
import { pnlCsv, usd } from './pnl.js';

function setup(now?: Date) {
  const world = fakeWorld(now);
  const finance = assembleFinance(world.ctx);
  return { world, finance, uc: finance.useCases };
}

const SEEDED_INVOICES = [
  ['Anthropic', 4410],
  ['Google Maps Platform', 1720],
  ['ZeroBounce', 480],
] as const;

function seedNovember(world: FakeWorld) {
  world.store.add(...seededExpenses());
  seedNovemberSources(world);
  for (const [provider, amountCents] of SEEDED_INVOICES) {
    world.store.invoices.set(`${provider}|2026-11`, {
      provider,
      month: '2026-11',
      amountCents,
      note: null,
      enteredAt: new Date('2026-11-19T10:00:00Z'),
      enteredByMemberId: staffActor.memberId,
    });
  }
}

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code: string; status?: number; details?: Record<string, unknown> };
  }
  throw new Error('expected an error');
};

describe('FR-13: Staff only', () => {
  test('every use case is 403 for an Owner and for no actor', async () => {
    const { uc } = setup();
    const calls = [
      () => uc.listExpenses.execute(ownerActor, { includeEnded: false }),
      () =>
        uc.createExpense.execute(ownerActor, {
          kind: 'one_off',
          name: 'x',
          vendor: 'x',
          category: 'other',
          amountCents: 1,
          spentOn: '2026-11-01',
        }),
      () => uc.updateExpense.execute(ownerActor, 'x', expensePatch({ name: 'y' })),
      () =>
        uc.addExpensePrice.execute(ownerActor, 'x', {
          effectiveFrom: '2026-12-01',
          amountCents: 1,
        }),
      () => uc.deleteExpensePrice.execute(ownerActor, 'x', '2026-12-01'),
      () => uc.deleteExpense.execute(ownerActor, 'x'),
      () => uc.listProviders.execute(ownerActor),
      () => uc.listProviderInvoices.execute(ownerActor, {}),
      () => uc.saveProviderInvoice.execute(ownerActor, 'twilio', '2026-11', { amountCents: 1 }),
      () => uc.deleteProviderInvoice.execute(ownerActor, 'twilio', '2026-11'),
      () => uc.getPnl.execute(null, {}),
      () => uc.exportPnlCsv.execute(ownerActor, { from: '2026-11', to: '2026-11' }),
      () => uc.getBudget.execute(ownerActor),
      () => uc.saveBudget.execute(ownerActor, { monthlyBudgetCents: 1 }),
    ];
    for (const call of calls) expect((await errorOf(call())).code).toBe('FORBIDDEN');
  });
});

describe('FR-1: Expenses list', () => {
  test('three Recurring bills and a One-off on Nov 14 are listed with amounts and cadences', async () => {
    const { world, uc } = setup();
    world.store.add(
      bill('DigitalOcean App Platform', 'hosting', 4215, '2026-11-05'),
      bill('Resend', 'email', 2000, '2026-11-18'),
      bill('llyner.com', 'domain_dns', 1499, '2026-11-02', { cadence: 'yearly' }),
      oneOff('Stickers', 'marketing', 1200, '2026-11-14'),
      oneOff('Courier', 'other', 100, '2026-11-01'),
    );
    const res = await uc.listExpenses.execute(staffActor, {
      month: '2026-11',
      includeEnded: false,
    });
    expect(res.items.map((i) => [i.name, i.amount.cents, i.cadence, i.status])).toEqual([
      ['DigitalOcean App Platform', 4215, 'monthly', 'active'],
      ['llyner.com', 1499, 'yearly', 'active'],
      ['Resend', 2000, 'monthly', 'active'],
      ['Courier', 100, null, 'active'],
      ['Stickers', 1200, null, 'active'],
    ]);
    expect(res.totals).toEqual({
      fixedRunRate: { cents: 4215 + 2000 + 125, currency: 'usd' },
      chargesInMonth: { cents: 4215 + 2000 + 1499 + 1200 + 100, currency: 'usd' },
    });
    expect(res.items[0]).toMatchObject({
      nextChargeOn: '2026-12-05',
      chargesInMonth: [{ date: '2026-11-05' }],
    });
  });

  test('a bill ending Nov 30 shows as Ended in December, with no December Charge', async () => {
    const { world, uc } = setup(new Date('2026-12-10T12:00:00Z'));
    world.store.add(bill('Old host', 'hosting', 1000, '2026-11-05', { endsOn: '2026-11-30' }));
    const dec = await uc.listExpenses.execute(staffActor, { month: '2026-12', includeEnded: true });
    expect(dec.items.map((i) => [i.name, i.status, i.chargesInMonth, i.nextChargeOn])).toEqual([
      ['Old host', 'ended', [], null],
    ]);
    expect(
      (await uc.listExpenses.execute(staffActor, { month: '2026-12', includeEnded: false })).items,
    ).toEqual([]);
    const nov = await uc.listExpenses.execute(staffActor, {
      month: '2026-11',
      includeEnded: false,
    });
    expect(nov.items.map((i) => i.status)).toEqual(['ended']);
  });

  test('filters: category and kind; One-offs of other months are left out', async () => {
    const { world, uc } = setup();
    world.store.add(
      bill('A', 'hosting', 100, '2026-11-01'),
      oneOff('B', 'other', 100, '2026-11-02'),
    );
    const byKind = await uc.listExpenses.execute(staffActor, {
      kind: 'one_off',
      includeEnded: false,
    });
    expect(byKind.items.map((i) => i.name)).toEqual(['B']);
    const byCategory = await uc.listExpenses.execute(staffActor, {
      category: 'hosting',
      includeEnded: false,
    });
    expect(byCategory.items.map((i) => i.name)).toEqual(['A']);
  });

  test('month rules: 2026-10 is 422 BEFORE_HISTORY_START, next month 422 FUTURE_MONTH', async () => {
    const { uc } = setup();
    expect(
      await errorOf(uc.listExpenses.execute(staffActor, { month: '2026-10', includeEnded: false })),
    ).toMatchObject({
      code: 'BEFORE_HISTORY_START',
      status: 422,
    });
    expect(
      await errorOf(uc.listExpenses.execute(staffActor, { month: '2026-12', includeEnded: false })),
    ).toMatchObject({
      code: 'FUTURE_MONTH',
      status: 422,
    });
  });
});

describe('FR-2: Add a Recurring bill', () => {
  const recurring = {
    kind: 'recurring' as const,
    name: 'DigitalOcean App Platform',
    vendor: 'DigitalOcean',
    category: 'hosting' as const,
    amountCents: 4215,
    cadence: 'monthly' as const,
    startsOn: '2026-11-05',
  };

  test('DigitalOcean $42.15 from Nov 5: November Hosting $42.15, next charge Dec 5; audit and analytics', async () => {
    const { world, uc } = setup();
    const created = await uc.createExpense.execute(staffActor, recurring);
    expect(created).toMatchObject({
      amount: { cents: 4215 },
      nextChargeOn: '2026-12-05',
      status: 'active',
    });
    const pnl = await uc.getPnl.execute(staffActor, { month: '2026-11' });
    expect(pnl.operating.lines).toEqual([
      { category: 'hosting', amount: { cents: 4215, currency: 'usd' } },
    ]);
    expect(world.audit.entries).toEqual([
      expect.objectContaining({
        action: 'expense.created',
        targetType: 'expense',
        targetId: created.id,
        staffMemberId: staffActor.memberId,
        details: expect.objectContaining({ name: 'DigitalOcean App Platform', amountCents: 4215 }),
      }),
    ]);
    expect(world.analytics.events[0]).toEqual({
      name: 'expense_created',
      actor: { memberId: staffActor.memberId, businessId: null },
      properties: {
        expense_id: created.id,
        kind: 'recurring',
        category: 'hosting',
        cadence: 'monthly',
        covers_provider: false,
      },
    });
  });

  test('a yearly $14.99 domain: November $14.99, December $0.00, run-rate +$1.25', async () => {
    const { world, uc } = setup();
    await uc.createExpense.execute(staffActor, {
      ...recurring,
      name: 'llyner.com',
      category: 'domain_dns',
      amountCents: 1499,
      cadence: 'yearly',
      startsOn: '2026-11-02',
    });
    const nov = await uc.getPnl.execute(staffActor, { month: '2026-11' });
    expect(nov.totalExpenses.cents).toBe(1499);
    expect(nov.fixedRunRate.cents).toBe(125);
    world.clock.set(new Date('2026-12-20T12:00:00Z'));
    expect((await uc.getPnl.execute(staffActor, { month: '2026-12' })).totalExpenses.cents).toBe(0);
  });

  test('a bill from Nov 25 has no November Charge on Nov 20', async () => {
    const { uc } = setup();
    await uc.createExpense.execute(staffActor, { ...recurring, startsOn: '2026-11-25' });
    expect((await uc.getPnl.execute(staffActor, {})).totalExpenses.cents).toBe(0);
  });

  test('a second bill covering Apify is 409 PROVIDER_ALREADY_COVERED naming the other bill', async () => {
    const { world, uc } = setup();
    const apify = {
      ...recurring,
      name: 'Apify Starter',
      category: 'data_providers' as const,
      coversProvider: 'apify',
    };
    const first = await uc.createExpense.execute(staffActor, apify);
    expect(first.coversProvider).toEqual({ key: 'apify', name: 'Apify' });
    const err = await errorOf(
      uc.createExpense.execute(staffActor, { ...apify, name: 'Apify Scale' }),
    );
    expect(err).toMatchObject({
      code: 'PROVIDER_ALREADY_COVERED',
      status: 409,
      details: { expenseId: first.id, name: 'Apify Starter' },
    });
    expect(world.store.expenses.size).toBe(1);
    expect(world.audit.entries).toHaveLength(1);
  });

  test('a plan ending before the next one starts is fine', async () => {
    const { uc } = setup();
    const apify = { ...recurring, category: 'data_providers' as const, coversProvider: 'apify' };
    await uc.createExpense.execute(staffActor, { ...apify, name: 'Old', endsOn: '2026-11-30' });
    expect(
      (
        await uc.createExpense.execute(staffActor, {
          ...apify,
          name: 'New',
          startsOn: '2026-12-01',
        })
      ).name,
    ).toBe('New');
  });

  test('unknown provider 404; wrong category 422; before November 2026 422', async () => {
    const { uc } = setup();
    expect(
      await errorOf(
        uc.createExpense.execute(staffActor, {
          ...recurring,
          category: 'ai',
          coversProvider: 'openai',
        }),
      ),
    ).toMatchObject({ code: 'UNKNOWN_PROVIDER', status: 404 });
    expect(
      await errorOf(
        uc.createExpense.execute(staffActor, { ...recurring, coversProvider: 'apify' }),
      ),
    ).toMatchObject({
      code: 'COVERS_PROVIDER_CATEGORY',
      status: 422,
    });
    expect(
      await errorOf(uc.createExpense.execute(staffActor, { ...recurring, startsOn: '2026-10-05' })),
    ).toMatchObject({
      code: 'BEFORE_HISTORY_START',
      status: 422,
    });
  });
});

describe('FR-3: price changes, edits, end, delete', () => {
  async function resend() {
    const s = setup();
    const created = await s.uc.createExpense.execute(staffActor, {
      kind: 'recurring',
      name: 'Resend',
      vendor: 'Resend',
      category: 'email',
      amountCents: 2000,
      cadence: 'monthly',
      startsOn: '2026-11-18',
    });
    s.world.audit.entries.length = 0;
    s.world.analytics.events.length = 0;
    return { ...s, id: created.id };
  }

  test('Resend $25.00 from Dec 18: November still $20.00, December $25.00; audit and analytics', async () => {
    const { world, uc, id } = await resend();
    const updated = await uc.addExpensePrice.execute(staffActor, id, {
      effectiveFrom: '2026-12-18',
      amountCents: 2500,
    });
    expect(updated.versions).toEqual([
      { effectiveFrom: '2026-11-18', amount: { cents: 2000, currency: 'usd' } },
      { effectiveFrom: '2026-12-18', amount: { cents: 2500, currency: 'usd' } },
    ]);
    expect(updated.amount.cents).toBe(2000);
    expect((await uc.getPnl.execute(staffActor, { month: '2026-11' })).operating.total.cents).toBe(
      2000,
    );
    world.clock.set(new Date('2026-12-20T00:00:00Z'));
    expect((await uc.getPnl.execute(staffActor, { month: '2026-12' })).operating.total.cents).toBe(
      2500,
    );
    expect(world.audit.entries[0]).toMatchObject({
      action: 'expense.price_changed',
      targetId: id,
      details: { effectiveFrom: '2026-12-18', amountCents: { from: 2000, to: 2500 } },
    });
    expect(world.analytics.events[0]).toMatchObject({
      name: 'expense_price_changed',
      properties: {
        expense_id: id,
        effective_from: '2026-12-18',
        old_cents: 2000,
        new_cents: 2500,
      },
    });
  });

  test('a price before the start is 422; a One-off is 409 NOT_RECURRING; unknown id 404', async () => {
    const { world, uc, id } = await resend();
    expect(
      await errorOf(
        uc.addExpensePrice.execute(staffActor, id, { effectiveFrom: '2026-11-17', amountCents: 1 }),
      ),
    ).toMatchObject({
      code: 'EFFECTIVE_BEFORE_START',
    });
    const o = oneOff('X', 'other', 100, '2026-11-02');
    world.store.add(o);
    expect(
      await errorOf(
        uc.addExpensePrice.execute(staffActor, o.id, {
          effectiveFrom: '2026-11-15',
          amountCents: 1,
        }),
      ),
    ).toMatchObject({
      code: 'NOT_RECURRING',
    });
    expect(
      (
        await errorOf(
          uc.addExpensePrice.execute(staffActor, '00000000-0000-4000-8000-00000000dead', {
            effectiveFrom: '2026-12-01',
            amountCents: 1,
          }),
        )
      ).code,
    ).toBe('NOT_FOUND');
  });

  test('removing a version: the first is 409 FIRST_VERSION; others go, with an audit entry', async () => {
    const { world, uc, id } = await resend();
    await uc.addExpensePrice.execute(staffActor, id, {
      effectiveFrom: '2026-12-18',
      amountCents: 2500,
    });
    expect((await errorOf(uc.deleteExpensePrice.execute(staffActor, id, '2026-11-18'))).code).toBe(
      'FIRST_VERSION',
    );
    expect((await errorOf(uc.deleteExpensePrice.execute(staffActor, id, '2026-12-01'))).code).toBe(
      'NOT_FOUND',
    );
    const after = await uc.deleteExpensePrice.execute(staffActor, id, '2026-12-18');
    expect(after.versions).toHaveLength(1);
    expect(world.audit.entries.at(-1)).toMatchObject({
      action: 'expense.price_changed',
      details: { effectiveFrom: '2026-12-18', amountCents: { from: 2500, to: null } },
    });
  });

  test('FR-13: a category change is audited as expense.updated { category: { from, to } }', async () => {
    const { world, uc } = setup();
    const b = bill('Figma', 'other', 1500, '2026-11-20');
    world.store.add(b);
    const updated = await uc.updateExpense.execute(
      staffActor,
      b.id,
      expensePatch({
        category: 'software_tools',
      }),
    );
    expect(updated.category).toBe('software_tools');
    expect(world.audit.entries).toEqual([
      expect.objectContaining({
        action: 'expense.updated',
        targetType: 'expense',
        targetId: b.id,
        details: { category: { from: 'other', to: 'software_tools' } },
      }),
    ]);
  });

  test('ending a bill is expense.ended; clearing endsOn resumes (expense.updated)', async () => {
    const { world, uc, id } = await resend();
    expect(
      (await uc.updateExpense.execute(staffActor, id, expensePatch({ endsOn: '2026-12-31' })))
        .status,
    ).toBe('ending');
    expect(
      (await uc.updateExpense.execute(staffActor, id, expensePatch({ endsOn: null }))).status,
    ).toBe('active');
    expect(world.audit.actions()).toEqual(['expense.ended', 'expense.updated']);
    expect(world.audit.entries[1]?.details).toEqual({ endsOn: { from: '2026-12-31', to: null } });
  });

  test('no change writes no audit entry', async () => {
    const { world, uc, id } = await resend();
    await uc.updateExpense.execute(staffActor, id, expensePatch({ name: 'Resend' }));
    expect(world.audit.entries).toEqual([]);
  });

  test('a One-off field on a Recurring bill is 400 on that field; covering clashes are 409', async () => {
    const { world, uc, id } = await resend();
    expect(
      await errorOf(uc.updateExpense.execute(staffActor, id, expensePatch({ amountCents: 100 }))),
    ).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { amountCents: "Can't be changed on a Recurring bill" },
    });
    const a = bill('Apify A', 'data_providers', 100, '2026-11-01', { coversProvider: 'Apify' });
    const b = bill('Apify B', 'data_providers', 100, '2026-11-01', { endsOn: '2026-11-02' });
    world.store.add(a, b);
    expect(
      await errorOf(
        uc.updateExpense.execute(staffActor, b.id, expensePatch({ coversProvider: 'apify' })),
      ),
    ).toMatchObject({
      code: 'PROVIDER_ALREADY_COVERED',
    });
    const off = await uc.updateExpense.execute(
      staffActor,
      a.id,
      expensePatch({ coversProvider: null }),
    );
    expect(off.coversProvider).toBeNull();
    expect(
      (await uc.updateExpense.execute(staffActor, b.id, expensePatch({ coversProvider: 'apify' })))
        .coversProvider?.name,
    ).toBe('Apify');
  });

  test('a bill with a November Charge cannot be deleted (409 HAS_CHARGES); one-offs can (soft)', async () => {
    const { world, uc, id } = await resend();
    expect(await errorOf(uc.deleteExpense.execute(staffActor, id))).toMatchObject({
      code: 'HAS_CHARGES',
      status: 409,
    });
    expect(world.store.expenses.get(id)?.deletedAt).toBeNull();
    const o = oneOff('Stickers', 'marketing', 1200, '2026-11-14');
    world.store.add(o);
    await uc.deleteExpense.execute(staffActor, o.id);
    expect(world.store.expenses.get(o.id)?.deletedAt).toEqual(world.clock.now());
    expect(world.audit.entries.at(-1)).toMatchObject({
      action: 'expense.deleted',
      targetId: o.id,
      details: { before: { name: 'Stickers', amountCents: 1200 } },
    });
    expect((await errorOf(uc.deleteExpense.execute(staffActor, o.id))).code).toBe('NOT_FOUND');
    expect(
      (await uc.listExpenses.execute(staffActor, { includeEnded: true })).items.map((i) => i.name),
    ).toEqual(['Resend']);
  });
});

describe('FR-4: One-off expenses', () => {
  const legal = {
    kind: 'one_off' as const,
    name: 'Terms and privacy review',
    vendor: 'Counsel',
    category: 'legal_admin' as const,
    amountCents: 30000,
    spentOn: '2026-11-12',
  };

  test('$300.00 on Nov 12 shows Legal & admin $300.00 under operating; audited and tracked', async () => {
    const { world, uc } = setup();
    const created = await uc.createExpense.execute(staffActor, legal);
    expect(created).toMatchObject({
      kind: 'one_off',
      cadence: null,
      versions: [],
      nextChargeOn: null,
      monthlyEquivalent: null,
    });
    const pnl = await uc.getPnl.execute(staffActor, {});
    expect(pnl.operating.lines).toEqual([
      { category: 'legal_admin', amount: { cents: 30000, currency: 'usd' } },
    ]);
    expect(world.audit.actions()).toEqual(['expense.created']);
    expect(world.analytics.events[0]?.properties).toMatchObject({
      kind: 'one_off',
      cadence: null,
      covers_provider: false,
    });
  });

  test('tomorrow is 400 "Date can\'t be in the future" and nothing is saved', async () => {
    const { world, uc } = setup();
    expect(
      await errorOf(uc.createExpense.execute(staffActor, { ...legal, spentOn: '2026-11-21' })),
    ).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { spentOn: "Date can't be in the future" },
    });
    expect(world.store.expenses.size).toBe(0);
    expect(world.audit.entries).toEqual([]);
  });

  test('edits may change amount and date', async () => {
    const { world, uc } = setup();
    const created = await uc.createExpense.execute(staffActor, legal);
    const edited = await uc.updateExpense.execute(
      staffActor,
      created.id,
      expensePatch({
        amountCents: 25000,
        spentOn: '2026-11-13',
      }),
    );
    expect(edited).toMatchObject({ amount: { cents: 25000 }, startsOn: '2026-11-13' });
    expect(world.audit.entries.at(-1)?.details).toEqual({
      amountCents: { from: 30000, to: 25000 },
      spentOn: { from: '2026-11-12', to: '2026-11-13' },
    });
    expect(
      await errorOf(
        uc.updateExpense.execute(
          staffActor,
          created.id,
          expensePatch({ cadence: 'monthly' } as never),
        ),
      ),
    ).toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(
      await errorOf(
        uc.updateExpense.execute(staffActor, created.id, expensePatch({ endsOn: '2026-12-01' })),
      ),
    ).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { endsOn: "Can't be changed on a One-off expense" },
    });
  });
});

describe('FR-5, FR-6: automatic lines', () => {
  test('pending and failed purchases add no fee or revenue', async () => {
    const { world, uc } = setup();
    world.billing
      .add({ amountCents: 4900, paidAt: new Date('2026-11-06T00:00:00Z') })
      .add({ amountCents: 9900, paidAt: null, status: 'pending' })
      .add({ amountCents: 9900, paidAt: null, status: 'failed' });
    const pnl = await uc.getPnl.execute(staffActor, {});
    expect(pnl.revenue).toMatchObject({ sales: { cents: 4900 }, salesCount: 1 });
    expect(pnl.costOfRevenue.lines.find((l) => l.source === 'stripe_fees')?.amount.cents).toBe(172);
  });

  test('Tool calls on Nov 30 23:59:59 and Dec 1 00:00:00 count in November and December', async () => {
    const { world, uc } = setup(new Date('2026-12-02T00:00:00Z'));
    world.tools
      .add('Twilio', 900_000, new Date('2026-11-30T23:59:59Z'))
      .add('Twilio', 1_500_000, new Date('2026-12-01T00:00:00Z'));
    const nov = await uc.listProviderInvoices.execute(staffActor, { month: '2026-11' });
    const dec = await uc.listProviderInvoices.execute(staffActor, { month: '2026-12' });
    expect(nov.rows.map((r) => r.metered.cents)).toEqual([90]);
    expect(dec.rows.map((r) => r.metered.cents)).toEqual([150]);
  });

  test('Anthropic $38.40 metered counts under AI', async () => {
    const { world, uc } = setup();
    world.tools.add('Anthropic', 38_400_000);
    const pnl = await uc.getPnl.execute(staffActor, {});
    expect(pnl.costOfRevenue.lines.find((l) => l.category === 'ai')?.amount.cents).toBe(3840);
  });

  test('FR-7 refunds: a December refund of a November $99.00 sale', async () => {
    const { world, uc } = setup(new Date('2026-12-05T00:00:00Z'));
    world.billing.add({
      amountCents: 9900,
      paidAt: new Date('2026-11-10T00:00:00Z'),
      refundedCents: 9900,
      refundedAt: new Date('2026-12-03T00:00:00Z'),
    });
    const nov = await uc.getPnl.execute(staffActor, { month: '2026-11' });
    const dec = await uc.getPnl.execute(staffActor, { month: '2026-12' });
    expect(nov.revenue.net.cents).toBe(9900);
    expect(dec.revenue).toMatchObject({ refunds: { cents: 9900 }, net: { cents: -9900 } });
  });
});

describe('FR-6: providers picker', () => {
  test('the catalog providers with keys and categories, sorted by name', async () => {
    const { uc } = setup();
    const { items } = await uc.listProviders.execute(staffActor);
    expect(items[0]).toEqual({ key: 'anthropic', name: 'Anthropic', category: 'ai' });
    expect(items.find((p) => p.name === 'Google Maps Platform')).toEqual({
      key: 'google-maps-platform',
      name: 'Google Maps Platform',
      category: 'data_providers',
    });
    expect(items).toHaveLength(9);
  });
});

describe('FR-8: Provider invoices', () => {
  test('Google $12.75 metered + invoice $17.20: invoice counted, gap +34.9%, flagged; audit and analytics', async () => {
    const { world, uc } = setup();
    world.tools.add('Google Maps Platform', 12_750_000);
    const row = await uc.saveProviderInvoice.execute(
      staffActor,
      'google-maps-platform',
      '2026-11',
      { amountCents: 1720, note: 'Nov invoice' },
    );
    expect(row).toMatchObject({
      provider: { key: 'google-maps-platform', name: 'Google Maps Platform' },
      metered: { cents: 1275 },
      counted: { source: 'invoice', amount: { cents: 1720 } },
      gapPct: 34.9,
      flagged: true,
      invoice: {
        amount: { cents: 1720 },
        note: 'Nov invoice',
        enteredBy: { id: staffActor.memberId, email: STAFF_EMAIL },
      },
    });
    const list = await uc.listProviderInvoices.execute(staffActor, {});
    expect(list.flaggedCount).toBe(1);
    expect((await uc.getPnl.execute(staffActor, {})).providerFlags).toBe(1);
    expect(world.audit.entries).toEqual([
      expect.objectContaining({
        action: 'provider_invoice.saved',
        targetType: 'provider_invoice',
        targetId: 'google-maps-platform:2026-11',
        details: expect.objectContaining({ amountCents: { from: null, to: 1720 } }),
      }),
    ]);
    expect(world.analytics.events[0]).toMatchObject({
      name: 'provider_invoice_entered',
      properties: {
        provider: 'google-maps-platform',
        month: '2026-11',
        metered_cents: 1275,
        invoice_cents: 1720,
        gap_pct: 34.9,
        flagged: true,
      },
    });
  });

  test('saving again replaces it (audited from → to)', async () => {
    const { world, uc } = setup();
    await uc.saveProviderInvoice.execute(staffActor, 'twilio', '2026-11', { amountCents: 100 });
    await uc.saveProviderInvoice.execute(staffActor, 'twilio', '2026-11', { amountCents: 150 });
    expect(world.store.invoices.size).toBe(1);
    expect(world.audit.entries[1]?.details).toMatchObject({ amountCents: { from: 100, to: 150 } });
  });

  test('Apify plan $49.00, metered $22.10: plan counted, 45% used, Data providers not doubled', async () => {
    const { world, uc } = setup();
    world.store.add(
      bill('Apify Starter', 'data_providers', 4900, '2026-11-03', { coversProvider: 'Apify' }),
    );
    world.tools.add('Apify', 22_100_000);
    const { rows, totals } = await uc.listProviderInvoices.execute(staffActor, {});
    expect(rows[0]).toMatchObject({
      plan: { name: 'Apify Starter', amount: { cents: 4900 } },
      counted: { source: 'plan', amount: { cents: 4900 } },
      planUsedPct: 45,
      flagged: false,
    });
    expect(totals).toEqual({
      metered: { cents: 2210, currency: 'usd' },
      counted: { cents: 4900, currency: 'usd' },
    });
    const pnl = await uc.getPnl.execute(staffActor, {});
    expect(pnl.costOfRevenue.lines.find((l) => l.category === 'data_providers')?.amount.cents).toBe(
      4900,
    );
  });

  test('AJ-3: Twilio estimate $0.90 → invoice $1.50: gap +66.7%, gross profit $0.60 lower', async () => {
    const { world, uc } = setup();
    world.tools.add('Twilio', 900_000);
    const before = await uc.getPnl.execute(staffActor, {});
    expect((await uc.listProviderInvoices.execute(staffActor, {})).rows[0]?.counted.source).toBe(
      'estimate',
    );
    const row = await uc.saveProviderInvoice.execute(staffActor, 'twilio', '2026-11', {
      amountCents: 150,
    });
    expect(row).toMatchObject({ gapPct: 66.7, flagged: true, counted: { source: 'invoice' } });
    const after = await uc.getPnl.execute(staffActor, {});
    expect(before.grossProfit.cents - after.grossProfit.cents).toBe(60);
  });

  test('deleting the Anthropic $44.10 invoice reverts to the metered $38.40 estimate', async () => {
    const { world, uc } = setup();
    world.tools.add('Anthropic', 38_400_000);
    await uc.saveProviderInvoice.execute(staffActor, 'anthropic', '2026-11', { amountCents: 4410 });
    const row = await uc.deleteProviderInvoice.execute(staffActor, 'anthropic', '2026-11');
    expect(row).toMatchObject({
      invoice: null,
      counted: { source: 'estimate', amount: { cents: 3840 } },
      gapPct: null,
    });
    expect(world.audit.actions()).toEqual(['provider_invoice.saved', 'provider_invoice.deleted']);
    expect(world.audit.entries[1]?.details).toMatchObject({
      amountCents: { from: 4410, to: null },
    });
    expect(
      await errorOf(uc.deleteProviderInvoice.execute(staffActor, 'anthropic', '2026-11')),
    ).toMatchObject({
      code: 'NO_INVOICE',
      status: 404,
    });
  });

  test('a deleted invoice with nothing else left returns an empty estimate row', async () => {
    const { uc } = setup();
    await uc.saveProviderInvoice.execute(staffActor, 'hunter', '2026-11', { amountCents: 0 });
    expect(await uc.deleteProviderInvoice.execute(staffActor, 'hunter', '2026-11')).toMatchObject({
      metered: { cents: 0 },
      counted: { source: 'estimate', amount: { cents: 0 } },
    });
    expect((await uc.listProviderInvoices.execute(staffActor, {})).rows).toEqual([]);
  });

  test('unknown provider 404; months before history or in the future 422', async () => {
    const { uc } = setup();
    expect(
      await errorOf(
        uc.saveProviderInvoice.execute(staffActor, 'openai', '2026-11', { amountCents: 1 }),
      ),
    ).toMatchObject({
      code: 'UNKNOWN_PROVIDER',
      status: 404,
    });
    expect(
      (
        await errorOf(
          uc.saveProviderInvoice.execute(staffActor, 'twilio', '2026-10', { amountCents: 1 }),
        )
      ).code,
    ).toBe('BEFORE_HISTORY_START');
    expect(
      (
        await errorOf(
          uc.saveProviderInvoice.execute(staffActor, 'twilio', '2026-12', { amountCents: 1 }),
        )
      ).code,
    ).toBe('FUTURE_MONTH');
    expect(
      (await errorOf(uc.deleteProviderInvoice.execute(staffActor, 'twilio', '2027-01'))).code,
    ).toBe('FUTURE_MONTH');
  });
});

describe('FR-9: P&L', () => {
  test('the seeded November P&L (8a) and pnl_viewed', async () => {
    const { world, uc } = setup();
    seedNovember(world);
    const pnl = await uc.getPnl.execute(staffActor, { month: '2026-11' });
    expect({
      revenue: pnl.revenue.net.cents,
      sales: pnl.revenue.salesCount,
      cost: pnl.costOfRevenue.total.cents,
      gross: pnl.grossProfit.cents,
      margin: pnl.grossMarginPct,
      operating: pnl.operating.total.cents,
      net: pnl.netProfit.cents,
      total: pnl.totalExpenses.cents,
      runRate: pnl.fixedRunRate.cents,
      budget: pnl.budget,
      flags: pnl.providerFlags,
    }).toEqual({
      revenue: 19700,
      sales: 3,
      cost: 13861,
      gross: 5839,
      margin: 29.6,
      operating: 38414,
      net: -32575,
      total: 52275,
      runRate: 13540,
      budget: {
        amount: { cents: 30000, currency: 'usd' },
        spent: { cents: 52275, currency: 'usd' },
        pct: 174,
        status: 'over',
        alertsSent: [],
      },
      flags: 1,
    });
    expect(world.analytics.events).toEqual([
      expect.objectContaining({
        name: 'pnl_viewed',
        properties: { month: '2026-11', is_current_month: true },
      }),
    ]);
  });

  test('NFR-1: 12 trend months read with one range call each to billing and tools', async () => {
    const { world, uc } = setup(new Date('2027-10-20T12:00:00Z'));
    world.billing.add({ amountCents: 4900, paidAt: new Date('2027-03-06T15:00:00Z') });
    world.tools.add('Twilio', 900_000, new Date('2027-05-02T10:00:00Z'));
    const pnl = await uc.getPnl.execute(staffActor, { month: '2027-10' });
    expect(world.billing.calls).toBe(1);
    expect(world.tools.rangeCalls).toBe(1);
    expect(world.tools.providerCalls).toBeLessThanOrEqual(1);
    const byMonth = new Map(pnl.trend.map((t) => [t.month, t]));
    expect(byMonth.get('2027-03')?.revenue?.cents).toBe(4900);
    expect(byMonth.get('2027-05')?.expenses?.cents).toBe(90);
    expect(byMonth.get('2027-04')?.revenue?.cents).toBe(0);
  });

  test('finance analytics carry businessId null, even while Acting as', async () => {
    const { world, uc } = setup();
    const actingAs = {
      ...staffActor,
      businessId: '00000000-0000-4000-8000-0000000000cc',
      actingAs: {
        businessId: '00000000-0000-4000-8000-0000000000cc',
        businessName: 'Corner Coffee',
        staffMemberId: staffActor.memberId,
      },
    };
    await uc.getPnl.execute(actingAs, {});
    await uc.exportPnlCsv.execute(actingAs, { from: '2026-11', to: '2026-11' });
    await uc.saveProviderInvoice.execute(actingAs, 'twilio', '2026-11', { amountCents: 100 });
    const created = await uc.createExpense.execute(actingAs, {
      kind: 'recurring',
      name: 'Resend',
      vendor: 'Resend',
      category: 'email',
      amountCents: 2000,
      cadence: 'monthly',
      startsOn: '2026-11-18',
    });
    await uc.addExpensePrice.execute(actingAs, created.id, {
      effectiveFrom: '2026-12-18',
      amountCents: 2500,
    });
    expect(world.analytics.events.length).toBe(5);
    for (const e of world.analytics.events) {
      expect(e.actor, e.name).toEqual({ memberId: staffActor.memberId, businessId: null });
    }
  });

  test('a month with no data: every line $0.00, margin null', async () => {
    const { uc } = setup();
    const pnl = await uc.getPnl.execute(staffActor, {});
    expect(pnl.grossMarginPct).toBeNull();
    expect(pnl.costOfRevenue.lines.every((l) => l.amount.cents === 0)).toBe(true);
    expect(pnl.totalExpenses.cents).toBe(0);
    expect(pnl.trend.filter((t) => t.revenue !== null).map((t) => t.month)).toEqual(['2026-11']);
  });

  test('a past month is not month to date; pnl_viewed says so', async () => {
    const { world, uc } = setup(new Date('2026-12-05T00:00:00Z'));
    const pnl = await uc.getPnl.execute(staffActor, { month: '2026-11' });
    expect(pnl.monthToDate).toBe(false);
    expect(world.analytics.events[0]?.properties).toEqual({
      month: '2026-11',
      is_current_month: false,
    });
  });

  test('2026-10 is 422 BEFORE_HISTORY_START; next month is 422 FUTURE_MONTH', async () => {
    const { uc } = setup();
    expect((await errorOf(uc.getPnl.execute(staffActor, { month: '2026-10' }))).code).toBe(
      'BEFORE_HISTORY_START',
    );
    expect((await errorOf(uc.getPnl.execute(staffActor, { month: '2026-12' }))).code).toBe(
      'FUTURE_MONTH',
    );
  });

  test('NFR-4: two reads with no change are identical', async () => {
    const { world, uc } = setup();
    seedNovember(world);
    expect(await uc.getPnl.execute(staffActor, {})).toEqual(
      await uc.getPnl.execute(staffActor, {}),
    );
  });
});

describe('FR-10: CSV export', () => {
  test('November: revenue total 197.00, net -325.75, UTF-8 BOM, file name; audit and analytics', async () => {
    const { world, uc } = setup();
    seedNovember(world);
    const { fileName, csv } = await uc.exportPnlCsv.execute(staffActor, {
      from: '2026-11',
      to: '2026-11',
    });
    expect(fileName).toBe('llyner-leads-pnl-2026-11-to-2026-11.csv');
    expect(csv.startsWith('﻿month,section,category,item,source,amount_usd\r\n')).toBe(true);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines).toContain('2026-11,revenue,,Total,,197.00');
    expect(lines).toContain('2026-11,cost_of_revenue,,Total,,138.61');
    expect(lines).toContain('2026-11,operating,,Total,,384.14');
    expect(lines.at(-1)).toBe('2026-11,net,,Net profit,,-325.75');
    expect(lines).toContain(
      '2026-11,cost_of_revenue,payments_fees,"Stripe fees (estimated, 2.9% + 30¢ per sale)",stripe_fee,6.61',
    );
    expect(lines).toContain(
      '2026-11,cost_of_revenue,data_providers,Apify (Apify Starter),plan,49.00',
    );
    expect(lines).toContain('2026-11,cost_of_revenue,ai,Anthropic,invoice,44.10');
    expect(lines).toContain('2026-11,cost_of_revenue,data_providers,Twilio,estimate,0.90');
    expect(lines).toContain(
      '2026-11,operating,legal_admin,Terms and privacy review,one_off,300.00',
    );
    expect(lines).toContain('2026-11,operating,hosting,DigitalOcean App Platform,bill,42.15');
    expect(world.audit.entries).toEqual([
      expect.objectContaining({
        action: 'pnl.exported',
        targetType: 'pnl',
        details: { from: '2026-11', to: '2026-11' },
      }),
    ]);
    expect(world.analytics.events).toEqual([
      expect.objectContaining({
        name: 'pnl_exported',
        properties: { from_month: '2026-11', to_month: '2026-11' },
      }),
    ]);
  });

  test('refunds are negative; several months each get totals; month rules apply', async () => {
    const { world, uc } = setup(new Date('2026-12-05T00:00:00Z'));
    world.billing.add({
      amountCents: 9900,
      paidAt: new Date('2026-11-10T00:00:00Z'),
      refundedCents: 9900,
      refundedAt: new Date('2026-12-03T00:00:00Z'),
    });
    const { csv } = await uc.exportPnlCsv.execute(staffActor, { from: '2026-11', to: '2026-12' });
    expect(csv).toContain(',revenue,,Refund ');
    expect(csv).toContain('2026-12,revenue,,Total,,-99.00\r\n');
    expect(csv).toContain('2026-11,net,,Net profit,,95.83\r\n');
    expect(
      (await errorOf(uc.exportPnlCsv.execute(staffActor, { from: '2026-10', to: '2026-11' }))).code,
    ).toBe('BEFORE_HISTORY_START');
    expect(
      (await errorOf(uc.exportPnlCsv.execute(staffActor, { from: '2026-11', to: '2027-01' }))).code,
    ).toBe('FUTURE_MONTH');
  });

  test('usd and field escaping', () => {
    expect([usd(0), usd(5), usd(-32575), usd(19700)]).toEqual([
      '0.00',
      '0.05',
      '-325.75',
      '197.00',
    ]);
    const csv = pnlCsv([
      {
        month: '2026-11',
        items: [
          {
            section: 'operating',
            category: 'other',
            item: '=HYPERLINK("x")',
            source: 'one_off',
            amountCents: 100,
          },
        ],
        revenueCents: 0,
        costOfRevenueCents: 0,
        operatingCents: 100,
        netProfitCents: -100,
      } as never,
    ]);
    expect(csv).toContain(`2026-11,operating,other,"'=HYPERLINK(""x"")",one_off,1.00`);
  });
});

describe('FR-11: Budget', () => {
  test('GET: the default $300, never changed', async () => {
    const { uc } = setup();
    expect(await uc.getBudget.execute(staffActor)).toEqual({
      monthlyBudget: { cents: 30000, currency: 'usd' },
      updatedAt: '2026-11-20T12:00:00.000Z',
      updatedBy: null,
    });
  });

  test('$600 in November: 87% near; budget.changed with old and new values', async () => {
    const { world, uc } = setup();
    seedNovember(world);
    expect((await uc.getPnl.execute(staffActor, {})).budget).toMatchObject({
      pct: 174,
      status: 'over',
    });
    const saved = await uc.saveBudget.execute(staffActor, { monthlyBudgetCents: 60000 });
    expect(saved).toMatchObject({
      monthlyBudget: { cents: 60000 },
      updatedBy: { id: staffActor.memberId, email: STAFF_EMAIL },
    });
    expect((await uc.getPnl.execute(staffActor, {})).budget).toMatchObject({
      amount: { cents: 60000 },
      pct: 87,
      status: 'near',
    });
    expect(world.audit.entries).toEqual([
      expect.objectContaining({
        action: 'budget.changed',
        targetType: 'budget',
        details: { monthlyBudgetCents: { from: 30000, to: 60000 }, month: '2026-11' },
      }),
    ]);
  });

  test('past months keep the Budget in effect when first read', async () => {
    const { world, uc } = setup();
    await uc.getPnl.execute(staffActor, {});
    world.clock.set(new Date('2026-12-02T00:00:00Z'));
    await uc.saveBudget.execute(staffActor, { monthlyBudgetCents: 50000 });
    expect((await uc.getPnl.execute(staffActor, { month: '2026-11' })).budget.amount.cents).toBe(
      30000,
    );
    expect((await uc.getPnl.execute(staffActor, { month: '2026-12' })).budget.amount.cents).toBe(
      50000,
    );
  });

  test('alerts already sent show on the P&L', async () => {
    const { world, uc } = setup();
    world.store.alerts.set('2026-11', [80, 100]);
    expect((await uc.getPnl.execute(staffActor, {})).budget.alertsSent).toEqual([80, 100]);
  });

  test('FR-12 reuse: currentMonthSpend has the P&L numbers and the 3 biggest items', async () => {
    const { world, finance } = setup();
    seedNovember(world);
    expect(await finance.budget.currentMonthSpend()).toEqual({
      month: '2026-11',
      spentCents: 52275,
      budgetCents: 30000,
      pct: 174,
      status: 'over',
      alertsSent: [],
      topItems: [
        {
          name: 'Terms and privacy review',
          category: 'legal_admin',
          categoryLabel: 'Legal & admin',
          amountCents: 30000,
        },
        {
          name: 'Apify (Apify Starter)',
          category: 'data_providers',
          categoryLabel: 'Data providers',
          amountCents: 4900,
        },
        { name: null, category: 'ai', categoryLabel: 'AI', amountCents: 4410 },
      ],
    });
    expect(world.store.snapshots.get('2026-11')).toBe(30000);
  });
});
