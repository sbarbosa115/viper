import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { InMemoryEmailSender } from '../../../shared/infrastructure/email/in-memory-email-sender.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { createAuditLog } from '../../platform/index.js';
import { expensePatch } from '../http/expense-patch.js';
import { createFinance } from '../index.js';
import { NOW } from '../test/factories.js';
import { CATALOG, staffActor } from '../test/fakes.js';

const db = createDatabase(process.env.DATABASE_URL_TEST ?? '');
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
  billing: { revenueForMonths: () => Promise.resolve([]) },
  tools: {
    meteredCostByProviderMonths: () => Promise.resolve([]),
    providers: () => Promise.resolve(CATALOG),
  },
  staff: { staffRecipients: () => Promise.resolve([]) },
  members: { memberEmails: () => Promise.resolve(new Map()) },
});
const uc = finance.useCases;

beforeEach(async () => {
  await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
  for (const t of ['expense_prices', 'expenses', 'audit_log'])
    await sql.raw(`TRUNCATE TABLE ${t}`).execute(db);
  await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);
});

afterAll(async () => {
  await db.destroy();
});

const plan = (name: string, coversProvider?: string) => ({
  kind: 'recurring' as const,
  name,
  vendor: 'Apify',
  category: 'data_providers' as const,
  amountCents: 4900,
  cadence: 'monthly' as const,
  startsOn: '2026-11-03',
  ...(coversProvider ? { coversProvider } : {}),
});

const outcome = (r: PromiseSettledResult<unknown>) =>
  r.status === 'fulfilled' ? 'ok' : (r.reason as { code?: string }).code;

const covering = async () =>
  (await db.selectFrom('expenses').select('id').where('covers_provider', '=', 'Apify').execute())
    .length;

describe('FR-2: at most one bill covers a provider, even under concurrent writes (MySQL)', () => {
  test('two concurrent creates covering Apify: one succeeds, the other 409 PROVIDER_ALREADY_COVERED', async () => {
    const results = await Promise.allSettled([
      uc.createExpense.execute(staffActor, plan('Apify Starter', 'apify')),
      uc.createExpense.execute(staffActor, plan('Apify Scale', 'apify')),
    ]);
    expect(results.map(outcome).sort()).toEqual(['PROVIDER_ALREADY_COVERED', 'ok']);
    expect(await covering()).toBe(1);
  });

  test('two concurrent PATCHes setting coversProvider: one succeeds, the other 409', async () => {
    const a = await uc.createExpense.execute(staffActor, plan('Apify Starter'));
    const b = await uc.createExpense.execute(staffActor, plan('Apify Scale'));
    const cover = (id: string) =>
      uc.updateExpense.execute(staffActor, id, expensePatch({ coversProvider: 'apify' }));
    const results = await Promise.allSettled([cover(a.id), cover(b.id)]);
    expect(results.map(outcome).sort()).toEqual(['PROVIDER_ALREADY_COVERED', 'ok']);
    expect(await covering()).toBe(1);
  });
});
