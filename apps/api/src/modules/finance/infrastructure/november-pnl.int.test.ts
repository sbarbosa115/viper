import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { InMemoryEmailSender } from '../../../shared/infrastructure/email/in-memory-email-sender.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { seed as seedBilling } from '../../billing/index.js';
import { createAuditLog } from '../../platform/index.js';
import { seed as seedTools } from '../../tools/index.js';
import { createFinance, seed as seedFinance } from '../index.js';
import { NOW } from '../test/factories.js';
import { staffActor } from '../test/fakes.js';
import { mysqlSources } from '../test/mysql-sources.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const id = (n: number) => `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const demo = {
  businesses: { sweetSupply: id(0xd001), cleanDesk: id(0xd002), cornerCoffee: id(0xd003) },
  members: { staff: id(0xd104) },
  runs: { bakeriesNearAustin: id(0xd401) },
};

const TABLES = [
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
  'audit_log',
];

async function truncate(): Promise<void> {
  await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
  for (const t of TABLES) await sql.raw(`TRUNCATE TABLE ${t}`).execute(db);
  await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);
  await db
    .updateTable('finance_settings')
    .set({ monthly_budget_cents: 30000, updated_by_member_id: null })
    .where('id', '=', 1)
    .execute();
}

const clock = new FixedClock(NOW);
const ids = new Uuid7Generator();
const finance = createFinance({
  db,
  clock,
  ids,
  audit: createAuditLog({ db, clock, ids }),
  analytics: new RecordingAnalyticsTracker(),
  email: new InMemoryEmailSender(),
  appUrl: 'http://localhost:5173',
  logger: { info: () => undefined, warn: () => undefined },
  ...mysqlSources(db),
});
const staff = { ...staffActor, memberId: demo.members.staff };

beforeAll(async () => {
  await truncate();
  await seedBilling({ db, clock, demo });
  await seedTools({ db, clock, demo });
  await seedFinance({ db, demo });
});

afterAll(async () => {
  await truncate();
  await db.destroy();
});

describe('FR-9: the seeded November 2026 P&L on MySQL (prd-expenses 8a)', () => {
  test('revenue $197.00 (3 sales), cost $138.61, gross $58.39 (29.6%), operating $384.14, net −$325.75, total $522.75, run-rate $135.40', async () => {
    const pnl = await finance.useCases.getPnl.execute(staff, { month: '2026-11' });
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
    });
    expect(pnl.budget).toEqual({
      amount: { cents: 30000, currency: 'usd' },
      spent: { cents: 52275, currency: 'usd' },
      pct: 174,
      status: 'over',
      alertsSent: [80, 100],
    });
    expect(pnl.providerFlags).toBe(1);
  });

  test('FR-8: the Provider invoices tab for November', async () => {
    const { rows, flaggedCount } = await finance.useCases.listProviderInvoices.execute(staff, {
      month: '2026-11',
    });
    expect(
      rows.map((r) => [
        r.provider.name,
        r.metered.cents,
        r.counted.source,
        r.counted.amount.cents,
        r.gapPct,
        r.flagged,
      ]),
    ).toEqual([
      ['Anthropic', 3840, 'invoice', 4410, 14.8, false],
      ['Apify', 2210, 'plan', 4900, null, false],
      ['Firecrawl', 320, 'plan', 1600, null, false],
      ['Google Maps Platform', 1275, 'invoice', 1720, 34.9, true],
      ['Twilio', 90, 'estimate', 90, null, false],
      ['ZeroBounce', 480, 'invoice', 480, 0, false],
    ]);
    expect(flaggedCount).toBe(1);
  });

  test('FR-10: the November CSV has revenue 197.00 and net -325.75', async () => {
    const { csv } = await finance.useCases.exportPnlCsv.execute(staff, {
      from: '2026-11',
      to: '2026-11',
    });
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('2026-11,revenue,,Total,,197.00\r\n');
    expect(csv).toContain('2026-11,net,,Net profit,,-325.75\r\n');
    const audit = await db.selectFrom('audit_log').select(['action', 'target_type']).execute();
    expect(audit).toEqual([{ action: 'pnl.exported', target_type: 'pnl' }]);
  });

  test('FR-12 reuse: currentMonthSpend on the seed', async () => {
    const spend = await finance.budget.currentMonthSpend();
    expect(spend).toMatchObject({
      month: '2026-11',
      spentCents: 52275,
      budgetCents: 30000,
      pct: 174,
      status: 'over',
      alertsSent: [80, 100],
    });
    expect(spend.topItems.map((i) => i.name)).toEqual([
      'Terms and privacy review',
      'Apify (Apify Starter)',
      null,
    ]);
  });

  test('NFR-1: the November P&L is a handful of aggregate queries (well under 300 ms here)', async () => {
    const started = performance.now();
    await finance.useCases.getPnl.execute(staff, { month: '2026-11' });
    expect(performance.now() - started).toBeLessThan(300);
  });
});
