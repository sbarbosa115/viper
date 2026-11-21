import { describe, expect, test } from 'vitest';
import {
  bill,
  centsToMicros,
  invoice,
  oneOff,
  sale,
  seededExpenses,
  seededNovember,
  TODAY,
} from '../test/factories.js';
import { budgetProgress, thresholdsReached } from './budget.js';
import type { Expense } from './expense.js';
import {
  biggestItems,
  buildPnl,
  computeMonth,
  EMPTY_MONTH,
  fixedRunRateCents,
  microsToCents,
  providerLines,
  refundNetCents,
  stripeFeeCents,
  type MonthData,
} from './pnl.js';

const month = (expenses: Expense[], data: Partial<MonthData> = {}, m = '2026-11', today = TODAY) =>
  computeMonth({ month: m, today, expenses, data: { ...EMPTY_MONTH, ...data } });

const pnl = (
  expenses: Expense[],
  data: Record<string, Partial<MonthData>>,
  m = '2026-11',
  today = TODAY,
  budgetCents = 30000,
) =>
  buildPnl({
    month: m,
    today,
    expenses,
    data: new Map(Object.entries(data).map(([k, v]) => [k, { ...EMPTY_MONTH, ...v }])),
    budget: { cents: budgetCents, alertsSent: [] },
  });

describe('FR-9: the seeded November P&L (prd-expenses 8a)', () => {
  const p = pnl(seededExpenses(), { '2026-11': seededNovember() });

  test('revenue $197.00 (3 sales), cost of revenue $138.61, gross $58.39 (29.6%)', () => {
    expect(p.revenueCents).toBe(19700);
    expect(p.salesCount).toBe(3);
    expect(p.costOfRevenueCents).toBe(13861);
    expect(p.grossProfitCents).toBe(5839);
    expect(p.grossMarginPct).toBe(29.6);
  });

  test('operating $384.14, net −$325.75, total $522.75, run-rate $135.40', () => {
    expect(p.operatingCents).toBe(38414);
    expect(p.netProfitCents).toBe(-32575);
    expect(p.totalExpensesCents).toBe(52275);
    expect(p.fixedRunRateCents).toBe(13540);
  });

  test('cost lines: providers per category, Stripe fees, no plain bill line for the plans', () => {
    expect(p.costLines.map((l) => [l.category, l.source, l.amountCents])).toEqual([
      ['data_providers', 'providers', 1720 + 480 + 90 + 4900 + 1600],
      ['ai', 'providers', 4410],
      ['payments_fees', 'stripe_fees', 661],
    ]);
    expect(p.costLines[2]?.label).toBe('Stripe fees (estimated, 2.9% + 30¢ per sale)');
  });

  test('operating lines by category in the fixed order', () => {
    expect(p.operatingLines).toEqual([
      { category: 'hosting', amountCents: 4215 },
      { category: 'email', amountCents: 2000 },
      { category: 'domain_dns', amountCents: 1499 },
      { category: 'software_tools', amountCents: 700 },
      { category: 'legal_admin', amountCents: 30000 },
    ]);
  });

  test('category breakdown: non-zero, largest first, share of total expenses', () => {
    expect(p.categories.map((c) => [c.category, c.amountCents, c.sharePct])).toEqual([
      ['legal_admin', 30000, 57.4],
      ['data_providers', 8790, 16.8],
      ['ai', 4410, 8.4],
      ['hosting', 4215, 8.1],
      ['email', 2000, 3.8],
      ['domain_dns', 1499, 2.9],
      ['software_tools', 700, 1.3],
      ['payments_fees', 661, 1.3],
    ]);
  });

  test('yearly bills this month with their monthly equivalent', () => {
    expect(p.yearlyThisMonth.map((y) => [y.name, y.amountCents, y.monthlyEquivalentCents])).toEqual(
      [['llyner.com', 1499, 125]],
    );
  });

  test('FR-11: $522.75 of a $300 Budget is 174% over', () => {
    expect(p.budget).toMatchObject({
      spentCents: 52275,
      budgetCents: 30000,
      pct: 174,
      status: 'over',
    });
    expect(p.monthToDate).toBe(true);
    expect(p.flaggedCount).toBe(1);
  });

  test('FR-11: a $600 Budget is 87% near', () => {
    expect(
      pnl(seededExpenses(), { '2026-11': seededNovember() }, '2026-11', TODAY, 60000).budget,
    ).toMatchObject({
      pct: 87,
      status: 'near',
    });
  });

  test('trend: 12 months oldest first, null before November 2026', () => {
    expect(p.trend).toHaveLength(12);
    expect(p.trend[0]).toEqual({
      month: '2025-12',
      revenueCents: null,
      expensesCents: null,
      netCents: null,
    });
    expect(p.trend[10]?.revenueCents).toBeNull();
    expect(p.trend[11]).toEqual({
      month: '2026-11',
      revenueCents: 19700,
      expensesCents: 52275,
      netCents: -32575,
    });
  });

  test('CSV items: revenue items sum to revenue; cost and operating items to their totals', () => {
    const total = (section: string) =>
      p.items.filter((i) => i.section === section).reduce((s, i) => s + i.amountCents, 0);
    expect(total('revenue')).toBe(19700);
    expect(total('cost_of_revenue')).toBe(13861);
    expect(total('operating')).toBe(38414);
    expect(p.items.find((i) => i.item.startsWith('Apify'))).toMatchObject({
      source: 'plan',
      amountCents: 4900,
    });
    expect(p.items.find((i) => i.item === 'Twilio')).toMatchObject({
      source: 'estimate',
      amountCents: 90,
    });
  });

  test('FR-12 reuse: the 3 biggest items, automatic lines by category', () => {
    expect(biggestItems(p)).toEqual([
      { name: 'Terms and privacy review', category: 'legal_admin', amountCents: 30000 },
      { name: 'Apify (Apify Starter)', category: 'data_providers', amountCents: 4900 },
      { name: null, category: 'ai', amountCents: 4410 },
    ]);
  });
});

describe('FR-9: rules', () => {
  test('no data: every line $0.00, margin null, trend zero for months in history', () => {
    const p = pnl([], {}, '2026-12', '2026-12-10');
    expect(p.revenueCents).toBe(0);
    expect(p.grossMarginPct).toBeNull();
    expect(p.costLines.every((l) => l.amountCents === 0)).toBe(true);
    expect(p.operatingLines).toEqual([]);
    expect(p.categories).toEqual([]);
    expect(p.totalExpensesCents).toBe(0);
    expect(p.budget).toMatchObject({ pct: 0, status: 'under' });
    expect(p.trend.at(-2)).toEqual({
      month: '2026-11',
      revenueCents: 0,
      expensesCents: 0,
      netCents: 0,
    });
  });

  test('FR-2: a yearly bill counts in full in its month, $0.00 the next; run-rate adds amount / 12', () => {
    const domain = bill('llyner.com', 'domain_dns', 1499, '2026-11-02', { cadence: 'yearly' });
    expect(month([domain]).operatingCents).toBe(1499);
    expect(month([domain], {}, '2026-12', '2026-12-31').operatingCents).toBe(0);
    expect(fixedRunRateCents([domain], TODAY)).toBe(125);
  });

  test('FR-2: DigitalOcean $42.15 from Nov 5 shows Hosting $42.15', () => {
    const m = month([bill('DigitalOcean App Platform', 'hosting', 4215, '2026-11-05')]);
    expect(m.operatingLines).toEqual([{ category: 'hosting', amountCents: 4215 }]);
  });

  test('FR-2: a bill from Nov 25 has no Charge on Nov 20; the month-to-date counts only the past', () => {
    expect(month([bill('Later', 'hosting', 1000, '2026-11-25')]).totalExpensesCents).toBe(0);
    expect(
      month([bill('Later', 'hosting', 1000, '2026-11-25')], {}, '2026-11', '2026-11-25')
        .totalExpensesCents,
    ).toBe(1000);
  });

  test('FR-3: Resend $20 → $25 from Dec 18: November $20.00, December $25.00', () => {
    const resend = bill('Resend', 'email', 2000, '2026-11-18', {
      prices: [{ effectiveFrom: '2026-12-18', amountCents: 2500 }],
    });
    expect(month([resend], {}, '2026-11', '2026-12-20').operatingCents).toBe(2000);
    expect(month([resend], {}, '2026-12', '2026-12-20').operatingCents).toBe(2500);
  });

  test('FR-4: a One-off counts under operating expenses in its month', () => {
    const m = month([oneOff('Terms and privacy review', 'legal_admin', 30000, '2026-11-12')]);
    expect(m.operatingLines).toEqual([{ category: 'legal_admin', amountCents: 30000 }]);
    expect(m.items).toEqual([
      {
        section: 'operating',
        category: 'legal_admin',
        item: 'Terms and privacy review',
        source: 'one_off',
        amountCents: 30000,
      },
    ]);
  });

  test('bills in cost-of-revenue categories that cover no provider are cost of revenue', () => {
    const m = month([
      bill('Proxy pool', 'data_providers', 1000, '2026-11-01'),
      oneOff('Chargeback fee', 'payments_fees', 1500, '2026-11-02'),
    ]);
    expect(m.costLines.filter((l) => l.source === 'bills')).toEqual([
      {
        category: 'data_providers',
        label: 'Data providers bills',
        amountCents: 1000,
        source: 'bills',
      },
      {
        category: 'payments_fees',
        label: 'Payments fees bills',
        amountCents: 1500,
        source: 'bills',
      },
    ]);
    expect(m.costOfRevenueCents).toBe(2500);
    expect(m.operatingCents).toBe(0);
  });

  test('gross margin is one decimal and can be negative', () => {
    const m = month([oneOff('X', 'ai', 3000, '2026-11-02')], { sales: [sale(1000)] });
    // revenue 10.00, cost 30.00 + fee 0.59 → gross −20.59
    expect(m.grossProfitCents).toBe(-2059);
    expect(m.grossMarginPct).toBe(-205.9);
  });

  test('the trend computes each month from its own data', () => {
    const p = pnl(
      [bill('DO', 'hosting', 4215, '2026-11-05')],
      {
        '2026-11': { sales: [sale(4900)] },
        '2026-12': { sales: [sale(9900, '2026-12-03T00:00:00Z')] },
      },
      '2027-01',
      '2027-01-10',
    );
    expect(p.trend.slice(-3).map((t) => [t.month, t.revenueCents, t.expensesCents])).toEqual([
      ['2026-11', 4900, 4215 + 172],
      ['2026-12', 9900, 4215 + 317],
      ['2027-01', 0, 4215],
    ]);
    expect(p.monthToDate).toBe(true);
    expect(pnl([], {}, '2026-11', '2027-01-10').monthToDate).toBe(false);
  });

  test("run-rate counts bills not ended today at today's price; ended bills drop out", () => {
    const expenses = [
      bill('A', 'hosting', 1000, '2026-11-01', {
        prices: [{ effectiveFrom: '2026-11-15', amountCents: 1200 }],
      }),
      bill('B', 'hosting', 500, '2026-11-01', { endsOn: '2026-11-19' }),
      bill('C', 'hosting', 300, '2026-11-01', { endsOn: '2026-11-20' }),
      oneOff('D', 'other', 9999, '2026-11-02'),
    ];
    expect(fixedRunRateCents(expenses, TODAY)).toBe(1500);
  });
});

describe('FR-5: Stripe fees (estimated)', () => {
  test('$49.00, $49.00 and $99.00 → $6.61; tax is in the total', () => {
    expect([4900, 4900, 9900].map((c) => stripeFeeCents({ amountCents: c, taxCents: 0 }))).toEqual([
      172, 172, 317,
    ]);
    expect(
      month([], { sales: [sale(4900), sale(4900), sale(9900)] }).costLines.at(-1)?.amountCents,
    ).toBe(661);
    expect(stripeFeeCents({ amountCents: 4900, taxCents: 400 })).toBe(30 + 154);
  });

  test('refunds do not return the fee', () => {
    const m = month([], {
      sales: [sale(9900)],
      refunds: [
        {
          purchaseId: 'p',
          refundedCents: 9900,
          amountCents: 9900,
          taxCents: 0,
          refundedAt: new Date('2026-11-12T00:00:00Z'),
        },
      ],
    });
    expect(m.revenueCents).toBe(0);
    expect(m.costOfRevenueCents).toBe(317);
  });
});

describe('FR-7 (arithmetic): refunds reverse revenue net of tax', () => {
  test('a full refund of $99.00 is −$99.00 in the refund month', () => {
    const refund = {
      purchaseId: 'p1',
      refundedCents: 9900,
      amountCents: 9900,
      taxCents: 0,
      refundedAt: new Date('2026-12-03T00:00:00Z'),
    };
    const dec = month([], { refunds: [refund] }, '2026-12', '2026-12-10');
    expect(dec.refundsCents).toBe(9900);
    expect(dec.revenueCents).toBe(-9900);
    expect(dec.items).toEqual([
      {
        section: 'revenue',
        category: null,
        item: 'Refund p1',
        source: 'refund',
        amountCents: -9900,
      },
    ]);
  });

  test('net of tax, rounded half up; partial refunds', () => {
    expect(refundNetCents({ refundedCents: 10800, amountCents: 9900, taxCents: 900 })).toBe(9900);
    expect(refundNetCents({ refundedCents: 5000, amountCents: 9900, taxCents: 900 })).toBe(4583);
    expect(refundNetCents({ refundedCents: 0, amountCents: 0, taxCents: 0 })).toBe(0);
  });
});

describe('FR-6: metered usage per provider', () => {
  test('micros → cents rounded half up per provider-month', () => {
    expect(microsToCents(38_400_000)).toBe(3840);
    expect(microsToCents(5_000)).toBe(1);
    expect(microsToCents(4_999)).toBe(0);
  });

  test('Anthropic $38.40 counts under AI as an estimate; others under Data providers', () => {
    const rows = providerLines({
      month: '2026-11',
      today: TODAY,
      expenses: [],
      metered: [
        { provider: 'Anthropic', micros: 38_400_000 },
        { provider: 'Hunter', micros: 1_000_000 },
        { provider: 'Hunter', micros: 500_000 },
      ],
      invoices: [],
    });
    expect(rows.map((r) => [r.provider, r.category, r.counted])).toEqual([
      ['Anthropic', 'ai', { source: 'estimate', amountCents: 3840, category: 'ai' }],
      [
        'Hunter',
        'data_providers',
        { source: 'estimate', amountCents: 150, category: 'data_providers' },
      ],
    ]);
  });

  test('providers with zero cost, no plan and no invoice are omitted', () => {
    const rows = providerLines({
      month: '2026-11',
      today: TODAY,
      expenses: [],
      metered: [{ provider: 'OpenStreetMap', micros: 0 }],
      invoices: [],
    });
    expect(rows).toEqual([]);
  });
});

describe('FR-8: provider invoices and the single-source rule', () => {
  const rows = (expenses: Expense[], data: Partial<MonthData>, today = TODAY) =>
    providerLines({
      month: '2026-11',
      today,
      expenses,
      metered: data.metered ?? [],
      invoices: data.invoices ?? [],
    });

  test('Google $12.75 metered, invoice $17.20: counts the invoice, gap +34.9%, flagged', () => {
    const [g] = rows([], {
      metered: [{ provider: 'Google Maps Platform', micros: centsToMicros(1275) }],
      invoices: [invoice('Google Maps Platform', 1720)],
    });
    expect(g).toMatchObject({
      meteredCents: 1275,
      counted: { source: 'invoice', amountCents: 1720 },
      gapPct: 34.9,
      flagged: true,
      planUsedPct: null,
    });
  });

  test('a gap of exactly 15% is not flagged; a negative gap beyond 15% is', () => {
    const [a, b] = rows([], {
      metered: [
        { provider: 'Apollo', micros: centsToMicros(1000) },
        { provider: 'Hunter', micros: centsToMicros(1000) },
      ],
      invoices: [invoice('Apollo', 1150), invoice('Hunter', 849)],
    });
    expect([a?.gapPct, a?.flagged]).toEqual([15, false]);
    expect([b?.gapPct, b?.flagged]).toEqual([-15.1, true]);
  });

  test('an invoice with metered 0 is flagged when above $0, with no gap', () => {
    const [a, b] = rows([], { invoices: [invoice('Apollo', 500), invoice('Hunter', 0)] });
    expect([a?.gapPct, a?.flagged, a?.counted.amountCents]).toEqual([null, true, 500]);
    expect([b?.gapPct, b?.flagged]).toEqual([null, false]);
  });

  test('Apify plan $49.00 with $22.10 metered: counts $49.00 (plan), 45% used, not flagged, no double count', () => {
    const apify = bill('Apify Starter', 'data_providers', 4900, '2026-11-03', {
      coversProvider: 'Apify',
    });
    const [row] = rows([apify], { metered: [{ provider: 'Apify', micros: centsToMicros(2210) }] });
    expect(row).toMatchObject({
      plan: { expenseId: apify.id, name: 'Apify Starter', amountCents: 4900 },
      counted: { source: 'plan', amountCents: 4900 },
      planUsedPct: 45,
      gapPct: null,
      flagged: false,
    });
    const m = month([apify], { metered: [{ provider: 'Apify', micros: centsToMicros(2210) }] });
    expect(m.costOfRevenueCents).toBe(4900);
  });

  test("an invoice beats the plan: the plan's Charge does not count at all", () => {
    const apify = bill('Apify Starter', 'data_providers', 4900, '2026-11-03', {
      coversProvider: 'Apify',
    });
    const data = {
      metered: [{ provider: 'Apify', micros: centsToMicros(2210) }],
      invoices: [invoice('Apify', 5200)],
    };
    const [row] = rows([apify], data);
    expect(row?.counted).toEqual({
      source: 'invoice',
      amountCents: 5200,
      category: 'data_providers',
    });
    expect(row?.planUsedPct).toBeNull();
    expect(month([apify], data).costOfRevenueCents).toBe(5200);
  });

  test('a plan starting later this month leaves the estimate; a yearly plan covers months without a Charge', () => {
    const plan = bill('Apify Starter', 'data_providers', 4900, '2026-11-25', {
      coversProvider: 'Apify',
    });
    expect(
      rows([plan], { metered: [{ provider: 'Apify', micros: centsToMicros(100) }] })[0]?.counted,
    ).toEqual({
      source: 'estimate',
      amountCents: 100,
      category: 'data_providers',
    });
    const yearly = bill('Apify yearly', 'data_providers', 40000, '2026-11-01', {
      coversProvider: 'Apify',
      cadence: 'yearly',
    });
    expect(
      providerLines({
        month: '2026-12',
        today: '2026-12-10',
        expenses: [yearly],
        metered: [{ provider: 'Apify', micros: centsToMicros(300) }],
        invoices: [],
      })[0]?.counted,
    ).toEqual({ source: 'plan', amountCents: 0, category: 'data_providers' });
  });

  test('a plan alone shows a row even without usage; an ended plan stops covering', () => {
    const plan = bill('Firecrawl Hobby', 'data_providers', 1600, '2026-11-04', {
      coversProvider: 'Firecrawl',
      endsOn: '2026-11-30',
    });
    expect(rows([plan], {})[0]).toMatchObject({
      counted: { source: 'plan', amountCents: 1600 },
      planUsedPct: 0,
    });
    expect(
      providerLines({
        month: '2026-12',
        today: '2026-12-10',
        expenses: [plan],
        metered: [],
        invoices: [],
      }),
    ).toEqual([]);
  });

  test('Twilio $0.90 and nothing else counts $0.90 as an estimate', () => {
    expect(rows([], { metered: [{ provider: 'Twilio', micros: 900_000 }] })[0]?.counted).toEqual({
      source: 'estimate',
      amountCents: 90,
      category: 'data_providers',
    });
  });

  test('without the Anthropic invoice, Anthropic reverts to its metered $38.40', () => {
    const data = { metered: [{ provider: 'Anthropic', micros: centsToMicros(3840) }] };
    expect(
      rows([], { ...data, invoices: [invoice('Anthropic', 4410)] })[0]?.counted.amountCents,
    ).toBe(4410);
    expect(rows([], data)[0]?.counted).toEqual({
      source: 'estimate',
      amountCents: 3840,
      category: 'ai',
    });
  });

  test('invoices for another month are ignored', () => {
    expect(rows([], { invoices: [invoice('Anthropic', 4410, '2026-12')] })).toEqual([]);
  });
});

describe('FR-11: Budget progress', () => {
  test.each([
    [0, 30000, 0, 'under'],
    [23999, 30000, 80, 'under'],
    [24000, 30000, 80, 'near'],
    [29999, 30000, 100, 'near'],
    [30000, 30000, 100, 'over'],
    [52275, 30000, 174, 'over'],
    [52275, 60000, 87, 'near'],
  ])('spent %i of %i → %i%% %s', (spent, budget, pct, status) => {
    expect(budgetProgress(spent, budget)).toEqual({
      spentCents: spent,
      budgetCents: budget,
      pct,
      status,
    });
  });

  test('a Budget of 0 is over as soon as anything is spent; pct null', () => {
    expect(budgetProgress(1, 0)).toMatchObject({ pct: null, status: 'over' });
    expect(budgetProgress(0, 0)).toMatchObject({ pct: null, status: 'under' });
  });

  test('thresholds reached (FR-12)', () => {
    expect(thresholdsReached(25000, 30000)).toEqual([80]);
    expect(thresholdsReached(40137, 30000)).toEqual([80, 100]);
    expect(thresholdsReached(10000, 30000)).toEqual([]);
    expect(thresholdsReached(1, 0)).toEqual([80, 100]);
  });
});
