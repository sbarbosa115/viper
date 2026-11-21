import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { createAuditLog } from '../../platform/index.js';
import { Expense } from '../domain/expense.js';
import { bill, NOW, oneOff, STAFF_ID } from '../test/factories.js';
import { KyselyFinanceStore } from './kysely-finance.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const clock = new FixedClock(NOW);
const ids = new Uuid7Generator();
const audit = createAuditLog({ db, clock, ids });
const store = new KyselyFinanceStore(db, audit);

const TABLES = [
  'expense_prices',
  'expenses',
  'provider_invoices',
  'finance_budgets',
  'budget_alerts',
  'audit_log',
];

beforeEach(async () => {
  await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
  for (const t of TABLES) await sql.raw(`TRUNCATE TABLE ${t}`).execute(db);
  await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);
  await db
    .updateTable('finance_settings')
    .set({ monthly_budget_cents: 30000, updated_by_member_id: null })
    .where('id', '=', 1)
    .execute();
});

afterAll(async () => {
  await db.destroy();
});

const auditRows = () =>
  db.selectFrom('audit_log').select(['action', 'target_type', 'target_id', 'details']).execute();

describe('finance on MySQL: expenses and price versions', () => {
  test('a bill round-trips with its versions; adding, replacing and removing versions', async () => {
    const b = bill('Resend', 'email', 2000, '2026-11-18', {
      id: ids.next(),
      prices: [{ effectiveFrom: '2026-12-18', amountCents: 2500 }],
    });
    await store.run((r) => r.expenses.save(b));
    const loaded = await store.read.expenses.findById(b.id);
    expect(loaded?.toSnapshot()).toEqual(b.toSnapshot());

    b.addPrice({ id: ids.next(), effectiveFrom: '2026-12-18', amountCents: 3000 }, NOW);
    b.addPrice({ id: ids.next(), effectiveFrom: '2027-01-18', amountCents: 3500 }, NOW);
    await store.run((r) => r.expenses.save(b));
    b.removePrice('2027-01-18', NOW);
    await store.run((r) => r.expenses.save(b));
    const again = await store.read.expenses.findById(b.id);
    expect(again?.versions.map((v) => [v.effectiveFrom, v.amountCents])).toEqual([
      ['2026-11-18', 2000],
      ['2026-12-18', 3000],
    ]);
  });

  test('DATE columns keep the calendar day; a One-off edit moves its only version', async () => {
    const o = Expense.createOneOff(
      {
        id: ids.next(),
        priceId: ids.next(),
        name: 'Terms and privacy review',
        vendor: 'Counsel',
        category: 'legal_admin',
        amountCents: 30000,
        spentOn: '2026-11-01',
        link: 'https://example.com/invoice',
        notes: 'Notes ✓',
        createdByMemberId: STAFF_ID,
      },
      NOW,
      '2026-11-20',
    );
    await store.run((r) => r.expenses.save(o));
    o.editOneOff({ spentOn: '2026-11-12', amountCents: 25000 }, NOW, '2026-11-20');
    await store.run((r) => r.expenses.save(o));
    const loaded = await store.read.expenses.findById(o.id);
    expect(loaded?.toSnapshot()).toMatchObject({
      startsOn: '2026-11-12',
      notes: 'Notes ✓',
      versions: [{ effectiveFrom: '2026-11-12', amountCents: 25000 }],
    });
  });

  test('soft-deleted expenses disappear from findById and listAll', async () => {
    const keep = bill('Keep', 'hosting', 100, '2026-11-01', {
      id: ids.next(),
      endsOn: '2026-12-31',
    });
    const drop = oneOff('Drop', 'other', 100, '2026-11-02');
    await store.run(async (r) => {
      await r.expenses.save(keep);
      await r.expenses.save(drop);
    });
    drop.markDeleted(NOW, '2026-11-20');
    await store.run((r) => r.expenses.save(drop));
    expect(await store.read.expenses.findById(drop.id)).toBeNull();
    expect((await store.read.expenses.listAll()).map((e) => [e.name, e.endsOn])).toEqual([
      ['Keep', '2026-12-31'],
    ]);
  });
});

describe('finance on MySQL: invoices, Budget, alerts', () => {
  test('an invoice is upserted per provider and month, read by months, and deleted', async () => {
    const invoice = {
      provider: 'Google Maps Platform',
      month: '2026-11',
      amountCents: 1720,
      note: null,
      enteredAt: NOW,
      enteredByMemberId: STAFF_ID,
    };
    await store.run(async (r) => {
      await r.invoices.save(invoice, NOW);
      await r.invoices.save({ ...invoice, amountCents: 1800, note: 'revised' }, NOW);
      await r.invoices.save({ ...invoice, provider: 'Anthropic', month: '2026-12' }, NOW);
    });
    expect(await store.read.invoices.find('Google Maps Platform', '2026-11')).toEqual({
      ...invoice,
      amountCents: 1800,
      note: 'revised',
    });
    expect((await store.read.invoices.forMonths(['2026-11'])).map((i) => i.provider)).toEqual([
      'Google Maps Platform',
    ]);
    expect(await store.read.invoices.forMonths([])).toEqual([]);
    await store.run((r) => r.invoices.delete('Google Maps Platform', '2026-11'));
    expect(await store.read.invoices.find('Google Maps Platform', '2026-11')).toBeNull();
  });

  test('settings, snapshots (ignore vs replace) and alerts', async () => {
    const budgets = store.read.budgets;
    expect((await budgets.settings()).monthlyBudgetCents).toBe(30000);
    await budgets.saveSettings({
      monthlyBudgetCents: 60000,
      updatedByMemberId: STAFF_ID,
      updatedAt: NOW,
    });
    expect(await budgets.settings()).toEqual({
      monthlyBudgetCents: 60000,
      updatedByMemberId: STAFF_ID,
      updatedAt: NOW,
    });
    await budgets.saveSnapshot('2026-11', 30000, NOW, false);
    await budgets.saveSnapshot('2026-11', 40000, NOW, false);
    expect(await budgets.snapshot('2026-11')).toBe(30000);
    await budgets.saveSnapshot('2026-11', 60000, NOW, true);
    expect(await budgets.snapshot('2026-11')).toBe(60000);
    expect(await budgets.snapshot('2026-12')).toBeNull();
    await db
      .insertInto('budget_alerts')
      .values([
        { month: '2026-11', threshold: 100, spent_cents: 1, budget_cents: 1, sent_at: NOW },
        { month: '2026-11', threshold: 80, spent_cents: 1, budget_cents: 1, sent_at: NOW },
      ])
      .execute();
    expect(await budgets.alertsSent('2026-11')).toEqual([80, 100]);
    expect(await budgets.alertsSent('2026-12')).toEqual([]);
  });
});

describe('FR-13 on MySQL: the Audit log commits with the change', () => {
  test('an audit entry is written in the same transaction', async () => {
    const b = bill('A', 'hosting', 100, '2026-11-01', { id: ids.next() });
    await store.run(async (r) => {
      await r.expenses.save(b);
      await r.audit.record({
        staffMemberId: STAFF_ID,
        businessId: null,
        action: 'expense.created',
        targetType: 'expense',
        targetId: b.id,
        details: { name: 'A' },
      });
    });
    expect(await auditRows()).toEqual([
      {
        action: 'expense.created',
        target_type: 'expense',
        target_id: b.id,
        details: { name: 'A' },
      },
    ]);
  });

  test('a failure after the write rolls back both the change and its audit entry', async () => {
    const b = bill('A', 'hosting', 100, '2026-11-01', { id: ids.next() });
    await expect(
      store.run(async (r) => {
        await r.expenses.save(b);
        await r.audit.record({
          staffMemberId: STAFF_ID,
          businessId: null,
          action: 'expense.created',
          targetType: 'expense',
          targetId: b.id,
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await store.read.expenses.findById(b.id)).toBeNull();
    expect(await auditRows()).toEqual([]);
  });
});
