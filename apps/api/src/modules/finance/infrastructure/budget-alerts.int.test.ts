import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { InMemoryEmailSender } from '../../../shared/infrastructure/email/in-memory-email-sender.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { SmtpEmailSender } from '../../platform/infrastructure/smtp-email-sender.js';
import { fakeSettingsReader } from '../../platform/test/fakes.js';
import { createAuditLog } from '../../platform/index.js';
import { createFinance } from '../index.js';
import { NOW, oneOff } from '../test/factories.js';
import { STAFF_ID } from '../test/factories.js';
import { KyselyFinanceStore } from './kysely-finance.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
const clock = new FixedClock(NOW);
const ids = new Uuid7Generator();
const audit = createAuditLog({ db, clock, ids });
const store = new KyselyFinanceStore(db, audit);

beforeEach(async () => {
  await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
  for (const t of ['expense_prices', 'expenses', 'budget_alerts', 'finance_budgets', 'audit_log'])
    await sql.raw(`TRUNCATE TABLE ${t}`).execute(db);
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

describe('FR-12: budget_alerts on MySQL', () => {
  test('insertAlert records a threshold once, even from two runs at the same time', async () => {
    const insert = () => store.run((r) => r.budgets.insertAlert('2026-11', 80, 25000, 30000, NOW));
    const results = await Promise.all([insert(), insert(), insert()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.read.budgets.alertsSent('2026-11')).toEqual([80]);
    expect(await insert()).toBe(false);
    expect(await store.run((r) => r.budgets.insertAlert('2026-11', 100, 31000, 30000, NOW))).toBe(
      true,
    );
    expect(await store.read.budgets.alertsSent('2026-11')).toEqual([80, 100]);
    expect(await store.read.budgets.alertsSent('2026-12')).toEqual([]);
  });

  test('two budget checks at the same time send one email', async () => {
    const email = new InMemoryEmailSender();
    const finance = createFinance({
      db,
      clock,
      ids,
      audit,
      analytics: new RecordingAnalyticsTracker(),
      email,
      appUrl: 'http://localhost:5173',
      logger: { info: () => undefined, warn: () => undefined },
      billing: { revenueForMonth: () => Promise.resolve({ sales: [], refunds: [] }) },
      tools: {
        meteredCostByProvider: () => Promise.resolve([]),
        providers: () => Promise.resolve([]),
      },
      staff: {
        staffRecipients: () =>
          Promise.resolve([{ memberId: STAFF_ID, email: 'staff@demo.test', name: 'Sam' }]),
      },
      members: { memberEmails: () => Promise.resolve(new Map()) },
    });
    await store.run((r) =>
      r.expenses.save(oneOff('Legal review', 'legal_admin', 25000, '2026-11-10')),
    );
    const runs = await Promise.all([finance.budgetCheck.execute(), finance.budgetCheck.execute()]);
    expect(runs.flat()).toEqual([80]);
    expect(email.sent).toHaveLength(1);
  });

  test('clearAlerts forgets one month only', async () => {
    await store.run((r) => r.budgets.insertAlert('2026-11', 80, 1, 1, NOW));
    await store.run((r) => r.budgets.insertAlert('2026-12', 80, 1, 1, NOW));
    await store.run((r) => r.budgets.clearAlerts('2026-11'));
    expect(await store.read.budgets.alertsSent('2026-11')).toEqual([]);
    expect(await store.read.budgets.alertsSent('2026-12')).toEqual([80]);
  });
});

const mailpitUrl = process.env.MAILPIT_URL;

describe.skipIf(!mailpitUrl)('FR-12: the budget alert email reaches Mailpit', () => {
  test('the 80% email is delivered to the Staff Member', async () => {
    const base = mailpitUrl ?? '';
    const to = `staff+${Date.now()}@llyner.test`;
    const settings = fakeSettingsReader({
      'email.host': new URL(base).hostname,
      'email.port': 1025,
      'email.tls': 'none',
      'email.fromAddress': 'hello@llyner.test',
    });
    const email = new SmtpEmailSender({ settings });
    try {
      const finance = createFinance({
        db,
        clock,
        ids,
        audit,
        analytics: new RecordingAnalyticsTracker(),
        email,
        appUrl: 'http://localhost:5173',
        logger: { info: () => undefined, warn: () => undefined },
        billing: { revenueForMonth: () => Promise.resolve({ sales: [], refunds: [] }) },
        tools: {
          meteredCostByProvider: () => Promise.resolve([]),
          providers: () => Promise.resolve([]),
        },
        staff: {
          staffRecipients: () => Promise.resolve([{ memberId: STAFF_ID, email: to, name: 'Sam' }]),
        },
        members: { memberEmails: () => Promise.resolve(new Map()) },
      });
      await store.run((r) =>
        r.expenses.save(oneOff('Legal review', 'legal_admin', 25000, '2026-11-10')),
      );
      expect(await finance.budgetCheck.execute()).toEqual([80]);
    } finally {
      email.close();
    }
    const res = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const body = (await res.json()) as { messages: { ID: string; Subject: string }[] };
    expect(body.messages.map((m) => m.Subject)).toEqual([
      'Spend passed 80% of the November budget',
    ]);
    const msg = (await (await fetch(`${base}/api/v1/message/${body.messages[0]!.ID}`)).json()) as {
      Text: string;
      HTML: string;
    };
    expect(msg.Text).toContain('$250.00 of the $300.00 budget (83%)');
    expect(msg.HTML).toContain('Open the P&amp;L');
  });
});
