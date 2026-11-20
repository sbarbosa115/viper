import { lead as leadContract } from '@app/contracts/leads';
import { sql } from 'kysely';
import { afterAll, describe, expect, test } from 'vitest';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { DEMO_SWEET_SUPPLY_LOCATION } from '../../planning/index.js';
import { createLeads, seed } from '../index.js';
import { describeLeadsBehaviour } from '../test/leads-behaviour.js';
import type { LeadRepository, LeadsUnitOfWork } from '../application/ports.js';
import { deliverCommand, PLAN, RUN_2, scoredProspect, setup } from '../test/leads-fixture.js';
import { kyselyLeadsUnitOfWork } from './kysely-leads.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const TABLES = ['lead_evidence', 'lead_contacts', 'leads', 'prospects', 'sources'];

async function truncate(): Promise<void> {
  await sql`SET FOREIGN_KEY_CHECKS=0`.execute(db);
  for (const t of TABLES) await sql.raw(`TRUNCATE TABLE ${t}`).execute(db);
  await sql`SET FOREIGN_KEY_CHECKS=1`.execute(db);
}

afterAll(async () => {
  await db.destroy();
});

describeLeadsBehaviour('MySQL', async () => {
  await truncate();
  return kyselyLeadsUnitOfWork(db);
});

describe('FR-25: delivery is one transaction (MySQL)', () => {
  test('when a write fails, no Lead, Contact, Evidence or Source of the delivery is kept', async () => {
    await truncate();
    const real = kyselyLeadsUnitOfWork(db);
    let failInsert = false;
    const uow: LeadsUnitOfWork = {
      run: (fn) =>
        real.run((repos) =>
          fn({
            ...repos,
            leads: new Proxy(repos.leads, {
              get(target, prop, receiver) {
                if (prop === 'insert' && failInsert) {
                  return async (...args: Parameters<LeadRepository['insert']>) => {
                    await target.insert(...args);
                    throw new Error('connection lost');
                  };
                }
                const value: unknown = Reflect.get(target, prop, receiver);
                return typeof value === 'function'
                  ? (value as (...a: unknown[]) => unknown).bind(target)
                  : value;
              },
            }),
          }),
        ),
    };
    const s = setup(uow);
    await scoredProspect(s.app.prospects, { fitScore: 90 });
    failInsert = true;
    await expect(s.app.prospects.deliver(deliverCommand())).rejects.toThrow('connection lost');
    for (const table of ['leads', 'lead_contacts', 'lead_evidence', 'sources'] as const) {
      const row = await db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow();
      expect(Number(row.n), table).toBe(0);
    }
    failInsert = false;
    expect(await s.app.prospects.deliver(deliverCommand())).toEqual({ delivered: 1 });
  });

  test('the database refuses a second Lead for the same place in a Plan', async () => {
    await truncate();
    const s = setup(kyselyLeadsUnitOfWork(db));
    await scoredProspect(s.app.prospects, { fitScore: 90 });
    await s.app.prospects.deliver(deliverCommand());
    const row = await db.selectFrom('leads').selectAll().executeTakeFirstOrThrow();
    await expect(
      db
        .insertInto('leads')
        .values({ ...row, id: '00000000-0000-7000-8000-0000000aaaaa', run_id: RUN_2 })
        .execute(),
    ).rejects.toThrow(/Duplicate entry/);
    expect(PLAN).toBe(row.plan_id);
  });
});

describe('§8a: seed', () => {
  const demo = {
    businesses: { sweetSupply: '00000000-0000-7000-8000-00000000d001' },
    members: { owner: '00000000-0000-7000-8000-00000000d101' },
    products: { caneSugar: '00000000-0000-7000-8000-00000000d201' },
    plans: { bakeriesNearAustin: '00000000-0000-7000-8000-00000000d301' },
    runs: { bakeriesNearAustin: '00000000-0000-7000-8000-00000000d401' },
  };
  const owner = {
    memberId: demo.members.owner,
    businessId: demo.businesses.sweetSupply,
    roles: ['owner'] as const,
    emailVerified: true,
  };

  test('25 Leads with mixed scores and Sources, Feedback on 5, idempotent', async () => {
    await truncate();
    const clock = new FixedClock(new Date('2026-11-19T09:00:00.000Z'));
    await seed({ db, clock, ids: new Uuid7Generator(), demo });
    await seed({ db, clock, ids: new Uuid7Generator(), demo });
    const leads = createLeads({
      db,
      clock,
      ids: new Uuid7Generator(),
      analytics: { track: () => Promise.resolve() },
      plans: {
        findPlan: (_b, p) =>
          Promise.resolve({
            id: p,
            name: 'Bakeries near Austin',
            centre: DEMO_SWEET_SUPPLY_LOCATION,
          }),
      },
    });
    const page = await leads.application.queries.listLeads(owner, demo.plans.bakeriesNearAustin, {
      sort: 'score',
      limit: 100,
    });
    expect(page.items).toHaveLength(25);
    expect(page.items.slice(0, 4).map((l) => [l.name, l.fitScore])).toEqual([
      ['Sweet Crumbs Bakery', 92],
      ['Golden Crust Bakehouse', 90],
      ['Flour & Fig', 88],
      ['Zilker Donut Shop', 86],
    ]);
    expect(page.items.at(-1)?.fitScore).toBe(60);
    expect(page.items.map((l) => l.name)).not.toContain('Dove Springs Donuts');
    expect(page.items.filter((l) => l.feedback !== null)).toHaveLength(5);
    expect(page.items.every((l) => l.distanceMiles !== null && l.distanceMiles <= 3)).toBe(true);
    expect(page.stats.total).toBe(25);
    const magnolia = page.items.find((l) => l.name === 'Magnolia Dessert Bar');
    const lead = await leads.application.queries.getLead(owner, magnolia?.id ?? '');
    expect(leadContract.parse(lead)).toEqual(lead);
    expect(lead).toMatchObject({ feedback: 'not_fit', feedbackReason: 'Closed' });
    expect(lead.contacts.find((c) => c.type === 'phone')?.value).toMatch(/^512-555-01\d\d$/);
    expect(lead.contacts.find((c) => c.type === 'email')?.value).toMatch(/@[a-z]+\.example$/);
    expect(lead.evidence.length).toBeGreaterThanOrEqual(2);
    const counts = await db
      .selectFrom('leads')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(counts.n)).toBe(25);
    const prospects = await db
      .selectFrom('prospects')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(prospects.n)).toBe(30);
  });
});
