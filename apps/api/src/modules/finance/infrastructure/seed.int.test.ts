import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { SystemClock } from '../../../shared/infrastructure/time/system-clock.js';
import { seed as seedBilling } from '../../billing/index.js';
import { seed as seedTools } from '../../tools/index.js';
import { seed as seedFinance } from '../index.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const id = (n: number) => `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const demo = {
  businesses: { sweetSupply: id(0xd001), cleanDesk: id(0xd002), cornerCoffee: id(0xd003) },
  members: { staff: id(0xd104) },
  runs: { bakeriesNearAustin: id(0xd401) },
};

const touched = [
  'credit_ledger',
  'reservations',
  'purchases',
  'credit_wallets',
  'credit_packs',
  'tool_calls',
  'tools',
  'expense_prices',
  'expenses',
  'provider_invoices',
  'finance_budgets',
  'budget_alerts',
];

async function truncate(): Promise<void> {
  await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
  for (const t of touched) await sql.raw(`TRUNCATE TABLE ${t}`).execute(db);
  await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);
}

async function seedAll(): Promise<void> {
  const clock = new SystemClock();
  await seedBilling({ db, clock, demo });
  await seedTools({ db, clock, demo });
  await seedFinance({ db, demo });
}

async function snapshot() {
  const count = async (t: string) =>
    Number(
      (await sql<{ n: number }>`SELECT COUNT(*) AS n FROM ${sql.table(t)}`.execute(db)).rows[0]?.n,
    );
  const counts = Object.fromEntries(
    await Promise.all(touched.map(async (t) => [t, await count(t)] as const)),
  );
  const metered = await db
    .selectFrom('tool_calls')
    .innerJoin('tools', 'tools.key', 'tool_calls.tool_key')
    .select(['tools.provider', sql<number>`SUM(tool_calls.provider_cost_micros)`.as('micros')])
    .where('tool_calls.created_at', '>=', new Date('2026-11-01T00:00:00Z'))
    .where('tool_calls.created_at', '<', new Date('2026-12-01T00:00:00Z'))
    .groupBy('tools.provider')
    .orderBy('tools.provider')
    .execute();
  const sales = await db
    .selectFrom('purchases')
    .select(['business_id', 'amount_cents', 'tax_cents'])
    .where('status', '=', 'paid')
    .where('paid_at', '>=', new Date('2026-11-01T00:00:00Z'))
    .where('paid_at', '<', new Date('2026-12-01T00:00:00Z'))
    .orderBy('paid_at')
    .execute();
  return { counts, metered, sales };
}

beforeAll(truncate);
afterAll(async () => {
  await truncate();
  await db.destroy();
});

describe('prd-expenses 8a: demo seed for November 2026', () => {
  test('seeds the bills, invoices, Budget, alerts, purchases and metered Tool calls; twice changes nothing', async () => {
    await seedAll();
    const first = await snapshot();
    await seedAll();
    expect(await snapshot()).toEqual(first);

    expect(first.sales.map((s) => [s.business_id, s.amount_cents, s.tax_cents])).toEqual([
      [demo.businesses.sweetSupply, 4900, 0],
      [demo.businesses.cornerCoffee, 4900, 0],
      [demo.businesses.sweetSupply, 9900, 0],
    ]);
    expect(first.metered.map((m) => [m.provider, Number(m.micros)])).toEqual([
      ['Anthropic', 38_400_000],
      ['Apify', 22_100_000],
      ['Firecrawl', 3_200_000],
      ['Google Maps Platform', 12_750_000],
      ['Twilio', 900_000],
      ['ZeroBounce', 4_800_000],
    ]);

    const expenses = await db
      .selectFrom('expenses')
      .innerJoin('expense_prices', 'expense_prices.expense_id', 'expenses.id')
      .select([
        'expenses.name',
        'expenses.kind',
        'expenses.category',
        'expenses.cadence',
        'expenses.starts_on',
        'expenses.covers_provider',
        'expense_prices.effective_from',
        'expense_prices.amount_cents',
      ])
      .orderBy('expenses.starts_on')
      .execute();
    expect(
      expenses.map((e) => [
        e.name,
        e.kind,
        e.category,
        e.cadence,
        e.starts_on.toISOString().slice(0, 10),
        e.covers_provider,
        e.amount_cents,
      ]),
    ).toEqual([
      ['llyner.com', 'recurring', 'domain_dns', 'yearly', '2026-11-02', null, 1499],
      ['Apify Starter', 'recurring', 'data_providers', 'monthly', '2026-11-03', 'Apify', 4900],
      [
        'Firecrawl Hobby',
        'recurring',
        'data_providers',
        'monthly',
        '2026-11-04',
        'Firecrawl',
        1600,
      ],
      ['DigitalOcean App Platform', 'recurring', 'hosting', 'monthly', '2026-11-05', null, 4215],
      ['1Password', 'recurring', 'software_tools', 'monthly', '2026-11-09', null, 700],
      ['Terms and privacy review', 'one_off', 'legal_admin', null, '2026-11-12', null, 30000],
      ['Resend', 'recurring', 'email', 'monthly', '2026-11-18', null, 2000],
    ]);
    for (const e of expenses) expect(e.effective_from).toEqual(e.starts_on);

    expect(
      await db
        .selectFrom('provider_invoices')
        .select(['provider', 'month', 'amount_cents'])
        .orderBy('provider')
        .execute(),
    ).toEqual([
      { provider: 'Anthropic', month: '2026-11', amount_cents: 4410 },
      { provider: 'Google Maps Platform', month: '2026-11', amount_cents: 1720 },
      { provider: 'ZeroBounce', month: '2026-11', amount_cents: 480 },
    ]);
    expect(
      await db.selectFrom('finance_settings').select(['id', 'monthly_budget_cents']).execute(),
    ).toEqual([{ id: 1, monthly_budget_cents: 30000 }]);
    expect(
      await db
        .selectFrom('budget_alerts')
        .select(['month', 'threshold', 'budget_cents', 'sent_at'])
        .orderBy('threshold')
        .execute(),
    ).toEqual([
      {
        month: '2026-11',
        threshold: 80,
        budget_cents: 30000,
        sent_at: new Date('2026-11-12T14:00:00Z'),
      },
      {
        month: '2026-11',
        threshold: 100,
        budget_cents: 30000,
        sent_at: new Date('2026-11-12T14:00:00Z'),
      },
    ]);
  });

  test('the purchases columns for refunds exist with their defaults', async () => {
    const row = await db
      .selectFrom('purchases')
      .select(['stripe_payment_intent_id', 'refunded_cents', 'refunded_at'])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ stripe_payment_intent_id: null, refunded_cents: 0, refunded_at: null });
  });
});
