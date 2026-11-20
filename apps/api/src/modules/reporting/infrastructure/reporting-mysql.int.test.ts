import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { createBilling, FakePaymentGateway } from '../../billing/index.js';
import { createIdentityQueries } from '../../identity/index.js';
import { createLeads } from '../../leads/index.js';
import { createResearchReportingQueries } from '../../research/index.js';
import { createToolQueries, type ProviderSettings } from '../../tools/index.js';
import { createReporting } from '../index.js';
import { RecordingAudit, staffActor } from '../test/fakes.js';
import { dashboardWorld, EXPECTED_DASHBOARD, IDS, NOW } from '../test/fixture.js';
import { mysqlSources } from '../test/mysql-sources.js';
import { truncateWorld, writeWorld } from '../test/mysql-world.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const clock = new FixedClock(NOW);
const ids = new Uuid7Generator();
const noAnalytics = { track: () => Promise.resolve() };
/** Tool spend reads no credentials. */
const noProviderSettings: ProviderSettings = {
  ai: () => Promise.resolve({ anthropicApiKey: null }),
  provider: () => Promise.reject(new Error('reporting tests read no provider settings')),
};

/** The real identity, billing, research, leads and tools queries on MySQL, as composition.ts wires them. */
function reportingOnMySql() {
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
  const audit = new RecordingAudit();
  return { reporting: createReporting({ ...sources, audit, clock }), audit };
}

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  await truncateWorld(db);
  await writeWorld(db, dashboardWorld());
});

describe("FR-30: Staff dashboard on MySQL (the real modules' queries)", () => {
  test('every number matches the hand-computed fixture, with the previous period', async () => {
    const { reporting } = reportingOnMySql();
    const result = await reporting.getDashboard.execute({ actor: staffActor, period: '30d' });
    expect(result).toEqual(EXPECTED_DASHBOARD);
  });
});

describe('FR-31: customer list on MySQL', () => {
  test('search "bakery" shows only matching Businesses, with every column', async () => {
    const { reporting } = reportingOnMySql();
    const page = await reporting.listCustomers.execute({
      actor: staffActor,
      q: 'bakery',
      sort: 'signedUp',
      limit: 50,
    });
    expect(page.items.map((c) => c.name)).toEqual(['Bakery Supplies Ltd']);
    const sweet = await reporting.listCustomers.execute({
      actor: staffActor,
      q: 'owner@demo',
      sort: 'signedUp',
      limit: 50,
    });
    expect(sweet.items).toEqual([
      {
        id: IDS.sweet,
        name: 'Sweet Supply Co',
        ownerEmail: 'owner@demo.test',
        signedUpAt: '2026-09-01T00:00:00.000Z',
        verified: true,
        availableCredits: 1_913,
        runs: 4,
        leadsDelivered: 50,
        lastActiveAt: '2026-11-20T14:00:00.000Z',
        paying: true,
        internal: false,
      },
    ]);
  });

  test('sorted by signed up or last active, newest first, 3 a page by cursor', async () => {
    const { reporting } = reportingOnMySql();
    const names: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof reporting.listCustomers.execute>> =
        await reporting.listCustomers.execute({
          actor: staffActor,
          sort: 'signedUp',
          limit: 3,
          ...(cursor ? { cursor } : {}),
        });
      names.push(...page.items.map((c) => c.name));
      cursor = page.nextCursor;
    } while (cursor);
    expect(names).toEqual([
      'Bakery Supplies Ltd',
      'Clean Desk Co',
      'QA Test Co',
      'Austin Bagels',
      'Corner Coffee Roasters',
      'Sweet Supply Co',
      'Llyner Leads (internal)',
    ]);
    const active = await reporting.listCustomers.execute({
      actor: staffActor,
      sort: 'lastActive',
      limit: 4,
    });
    expect(active.items.map((c) => c.name)).toEqual([
      'Sweet Supply Co',
      'Llyner Leads (internal)',
      'Bakery Supplies Ltd',
      'Corner Coffee Roasters',
    ]);
  });

  test('marking a Business internal takes it out of the customer and revenue tiles', async () => {
    const { reporting, audit } = reportingOnMySql();
    const row = await reporting.markBusinessInternal.execute({
      actor: staffActor,
      businessId: IDS.corner,
      internal: true,
    });
    expect(row).toMatchObject({ id: IDS.corner, internal: true, runs: 2, leadsDelivered: 20 });
    expect(audit.entries.map((e) => e.action)).toEqual(['business.updated']);
    const after = await reporting.getDashboard.execute({ actor: staffActor, period: '30d' });
    expect(after.customers.total.value).toBe(4);
    expect(after.revenue.packRevenue.value?.cents).toBe(0);
    expect(after.runs).toEqual(EXPECTED_DASHBOARD.runs);
    await reporting.markBusinessInternal.execute({
      actor: staffActor,
      businessId: IDS.corner,
      internal: false,
    });
    expect(await reporting.getDashboard.execute({ actor: staffActor, period: '30d' })).toEqual(
      EXPECTED_DASHBOARD,
    );
  });
});
