import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { createBilling, FakePaymentGateway } from '../../billing/index.js';
import { createIdentityQueries } from '../../identity/index.js';
import { createLeads } from '../../leads/index.js';
import { createResearchReportingQueries } from '../../research/index.js';
import { createToolQueries, type ProviderSettings } from '../../tools/index.js';
import type { ReportingSources } from '../application/ports.js';
import { createReporting } from '../index.js';
import { RecordingAudit, staffActor } from '../test/fakes.js';
import { mysqlSources } from '../test/mysql-sources.js';
import { truncateWorld, writeWorld } from '../test/mysql-world.js';
import { performanceWorld } from '../test/performance-world.js';

const NOW = new Date('2026-11-20T15:30:00.000Z');
const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const clock = new FixedClock(NOW);
const ids = new Uuid7Generator();
const noAnalytics = { track: () => Promise.resolve() };
/** Tool spend reads no credentials. */
const noProviderSettings: ProviderSettings = {
  ai: () => Promise.resolve({ anthropicApiKey: null }),
  provider: () => Promise.reject(new Error('reporting tests read no provider settings')),
};

/** Wall-clock time of every source call, by port method (to name the slow one). */
const timings = new Map<string, number[]>();

function timed<T extends object>(name: string, port: T): T {
  return new Proxy(port, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        const start = performance.now();
        try {
          return await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        } finally {
          const key = `${name}.${String(prop)}`;
          timings.set(key, [...(timings.get(key) ?? []), performance.now() - start]);
        }
      };
    },
  });
}

function reporting() {
  const billing = createBilling({
    db,
    clock,
    ids,
    analytics: noAnalytics,
    gateway: new FakePaymentGateway(ids, 'http://localhost'),
    audit: { record: () => Promise.resolve() },
    appUrl: 'http://localhost',
  });
  const leads = createLeads({
    db,
    clock,
    ids,
    analytics: noAnalytics,
    plans: { findPlan: () => Promise.resolve(null) },
  });
  const sources = mysqlSources({
    identity: createIdentityQueries({ db, clock, ids }),
    billing: billing.billingQueries,
    research: createResearchReportingQueries({ db, clock, ids }),
    leads: leads.leadsQueries,
    tools: createToolQueries({ db, settings: noProviderSettings }),
  });
  const wrapped: ReportingSources = {
    identity: timed('identity', sources.identity),
    billing: timed('billing', sources.billing),
    research: timed('research', sources.research),
    leads: timed('leads', sources.leads),
    tools: timed('tools', sources.tools),
  };
  return createReporting({ ...wrapped, audit: new RecordingAudit(), clock });
}

function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
}

async function measure(times: number, fn: () => Promise<unknown>): Promise<number[]> {
  for (let i = 0; i < 3; i++) await fn(); // warm-up: connections, plans, buffer pool
  const samples: number[] = [];
  for (let i = 0; i < times; i++) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  return samples;
}

const fmt = (ms: number) => `${ms.toFixed(1)} ms`;

const bySource = () =>
  [...timings]
    .map(([key, s]) => `${key} p95 ${fmt(p95(s))}`)
    .sort()
    .join('\n  ');

afterAll(async () => {
  await truncateWorld(db);
  await db.destroy();
});

beforeAll(async () => {
  await truncateWorld(db);
  await writeWorld(db, performanceWorld(NOW));
  await sql`ANALYZE TABLE leads, lead_contacts, research_runs, tool_calls, credit_ledger, purchases`.execute(
    db,
  );
}, 600_000);

describe('NFR-1: Staff dashboard < 1 s p95 with 50,000 Leads', () => {
  test('the seeded volume is there', async () => {
    const count = async (table: 'leads' | 'lead_contacts' | 'research_runs' | 'tool_calls') =>
      Number(
        (
          await db
            .selectFrom(table)
            .select((eb) => eb.fn.countAll<number>().as('n'))
            .executeTakeFirstOrThrow()
        ).n,
      );
    expect(await count('leads')).toBeGreaterThanOrEqual(50_000);
    expect(await count('lead_contacts')).toBeGreaterThanOrEqual(100_000);
    expect(await count('research_runs')).toBe(2_000);
    expect(await count('tool_calls')).toBe(100_000);
  });

  test.each(['30d', '90d'] as const)(
    'period %s: p95 under 1 s',
    async (period) => {
      timings.clear();
      const r = reporting();
      const samples = await measure(20, () =>
        r.getDashboard.execute({ actor: staffActor, period }),
      );
      const result = await r.getDashboard.execute({ actor: staffActor, period });
      expect(result.leads.delivered.value).toBeGreaterThan(0);
      console.info(`dashboard ${period}: p95 ${fmt(p95(samples))}\n  ${bySource()}`);
      expect(p95(samples)).toBeLessThan(1_000);
    },
    120_000,
  );

  test('customer list (50 a page, with every column): p95 reported', async () => {
    timings.clear();
    const r = reporting();
    const samples = await measure(20, () =>
      r.listCustomers.execute({ actor: staffActor, sort: 'lastActive', limit: 50 }),
    );
    console.info(`customer list: p95 ${fmt(p95(samples))}\n  ${bySource()}`);
    expect(p95(samples)).toBeLessThan(1_000);
  }, 120_000);
});
