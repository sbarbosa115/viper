import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getPnl } from '@app/contracts/finance';
import { buildTestApp } from '../../../../test/build-test-app.js';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { InMemoryEmailSender } from '../../../shared/infrastructure/email/in-memory-email-sender.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { createAuditLog } from '../../platform/index.js';
import { addMonths } from '../domain/calendar.js';
import { createFinance } from '../index.js';
import { bill, oneOff } from '../test/factories.js';
import { CATALOG, staffActor } from '../test/fakes.js';
import { mysqlSources } from '../test/mysql-sources.js';

/** 12 full months of history: the trend runs 2026-11 to 2027-10. */
const NOW = new Date('2027-10-28T12:00:00.000Z');
const MONTH = '2027-10';
const FIRST = '2026-11';
const TOOL_CALLS = 500_000;

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const clock = new FixedClock(NOW);
const ids = new Uuid7Generator();
const TABLES = [
  'tool_calls',
  'tools',
  'purchase_refunds',
  'purchases',
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
}

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

const TOOL_KEYS = CATALOG.flatMap((p) => p.toolKeys.map((key) => ({ key, provider: p.name })));

/** NFR-1 volume: 500,000 Tool calls over the 12 months, 200 Expenses, ~1,200 sales, refunds. */
async function writeVolume(): Promise<void> {
  await db
    .insertInto('tools')
    .values(
      TOOL_KEYS.map((t) => ({
        key: t.key,
        name: t.key,
        provider: t.provider,
        unit: 'call',
        provider_cost_micros_per_unit: 1000,
        credits_per_unit: 1,
        enabled: 1,
        max_units_per_call: 1,
        updated_at: NOW,
      })),
    )
    .execute();
  const keys = TOOL_KEYS.map((t) => `'${t.key}'`).join(',');
  // A numbers CTE (0..999 × 0..499) spreads the calls evenly over the 365 days before NOW.
  await sql
    .raw(
      `INSERT INTO tool_calls (id, business_id, tool_key, input_hash, input, provider_cost_micros, status, created_at)
       WITH RECURSIVE n (i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 999)
       SELECT UUID(), '00000000-0000-4000-8000-000000000001',
              ELT(1 + ((a.i * 500 + b.i) % ${TOOL_KEYS.length}), ${keys}),
              REPEAT('a', 64), '{}', 1000 + ((a.i * 7 + b.i * 13) % 20000), 'ok',
              TIMESTAMPADD(SECOND, -((a.i * 500 + b.i) * 63), '${NOW.toISOString().slice(0, 19).replace('T', ' ')}')
       FROM n a CROSS JOIN n b WHERE b.i < ${TOOL_CALLS / 1000}`,
    )
    .execute(db);

  const purchases = Array.from({ length: 1200 }, (_, i) => {
    const paidAt = new Date(NOW.getTime() - i * 6 * 3600 * 1000 * 1.2);
    return {
      id: `00000000-0000-4000-9000-${i.toString(16).padStart(12, '0')}`,
      business_id: '00000000-0000-4000-8000-000000000001',
      pack_id: '00000000-0000-4000-8000-000000000002',
      credits: 2500,
      stripe_session_id: `cs_perf_${i}`,
      amount_cents: 2500 + (i % 3) * 7500,
      tax_cents: i % 5 === 0 ? 200 : 0,
      status: 'paid' as const,
      created_at: paidAt,
      paid_at: paidAt,
    };
  });
  await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
  await db.insertInto('purchases').values(purchases).execute();
  await db
    .insertInto('purchase_refunds')
    .values(
      purchases
        .filter((_, i) => i % 40 === 0)
        .map((p, i) => ({
          id: `00000000-0000-4000-a000-${i.toString(16).padStart(12, '0')}`,
          purchase_id: p.id,
          stripe_event_id: `evt_perf_${i}`,
          delta_cents: 1000,
          refunded_at: new Date(p.paid_at.getTime() + 3600_000),
        })),
    )
    .execute();
  await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);

  await finance.store.run(async (r) => {
    for (let i = 0; i < 200; i++) {
      const startsOn = `${addMonths(FIRST, i % 12)}-${String(1 + (i % 28)).padStart(2, '0')}`;
      const expense =
        i % 4 === 3
          ? oneOff(`One-off ${i}`, 'other', 1000 + i, startsOn)
          : bill(`Bill ${i}`, 'software_tools', 500 + i, startsOn, {
              cadence: i % 10 === 0 ? 'yearly' : 'monthly',
              prices: i % 7 === 0 ? [{ effectiveFrom: '2027-06-01', amountCents: 900 + i }] : [],
            });
      await r.expenses.save(expense);
    }
    for (const [n, provider] of ['Apify', 'Firecrawl'].entries()) {
      await r.expenses.save(
        bill(`${provider} plan`, 'data_providers', 4900, `2026-11-0${n + 3}`, {
          coversProvider: provider,
        }),
      );
    }
  });
}

function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
}

beforeAll(async () => {
  await truncate();
  const start = performance.now();
  await writeVolume();
  await sql`ANALYZE TABLE tool_calls, purchases, purchase_refunds, expenses, expense_prices`.execute(
    db,
  );
  console.info(`P&L volume written in ${((performance.now() - start) / 1000).toFixed(1)} s`);
}, 600_000);

afterAll(async () => {
  await truncate();
  await db.destroy();
});

describe('NFR-1: GET /api/staff/finance/pnl p95 < 300 ms with 500,000 Tool calls', () => {
  test('the seeded volume is there', async () => {
    const { n } = await db
      .selectFrom('tool_calls')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(n)).toBe(TOOL_CALLS);
    expect((await finance.store.read.expenses.listAll()).length).toBe(202);
  });

  test('20 calls for the 12-month P&L: p95 under 300 ms', async () => {
    const app = await buildTestApp({ modules: [finance.module], actor: staffActor });
    const get = () => app.inject({ method: 'GET', url: `/api/staff/finance/pnl?month=${MONTH}` });
    for (let i = 0; i < 3; i++) await get(); // warm-up: connections, plans, buffer pool
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      const res = await get();
      samples.push(performance.now() - start);
      expect(res.statusCode).toBe(200);
    }
    const pnl = getPnl.response.parse((await get()).json());
    expect(pnl.trend.every((t) => t.revenue !== null)).toBe(true);
    expect(pnl.totalExpenses.cents).toBeGreaterThan(0);
    console.info(`P&L ${MONTH} (12 months): p95 ${p95(samples).toFixed(1)} ms`);
    expect(p95(samples)).toBeLessThan(300);
  }, 120_000);
});
