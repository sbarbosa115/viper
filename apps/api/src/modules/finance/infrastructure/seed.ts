import type { Database } from '../../../shared/infrastructure/db/database.js';
import type { ExpenseCategoryColumn } from './tables.js';

/**
 * prd-expenses section 8a, fixed to November 2026 so the P&L matches the mocks (revenue $197.00,
 * cost of revenue $138.61, operating $384.14, net −$325.75, run-rate $135.40). The purchases come
 * from billing's seed and the metered Tool calls from tools' seed.
 */
const fid = (n: number) => `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

interface SeedExpense {
  id: string;
  /** The id of its first (only) price version. */
  priceId: string;
  kind: 'recurring' | 'one_off';
  name: string;
  vendor: string;
  category: ExpenseCategoryColumn;
  cadence: 'monthly' | 'yearly' | null;
  startsOn: string;
  amountCents: number;
  coversProvider: string | null;
  link: string | null;
}

const bill = (
  n: number,
  name: string,
  vendor: string,
  category: ExpenseCategoryColumn,
  amountCents: number,
  cadence: 'monthly' | 'yearly',
  startsOn: string,
  coversProvider: string | null = null,
  link: string | null = null,
): SeedExpense => ({
  id: fid(0xf001 + n),
  priceId: fid(0xf101 + n),
  kind: 'recurring',
  name,
  vendor,
  category,
  cadence,
  startsOn,
  amountCents,
  coversProvider,
  link,
});

export const DEMO_EXPENSES: readonly SeedExpense[] = [
  bill(0, 'DigitalOcean App Platform', 'DigitalOcean', 'hosting', 4215, 'monthly', '2026-11-05'),
  bill(1, 'Resend', 'Resend', 'email', 2000, 'monthly', '2026-11-18'),
  bill(2, 'llyner.com', 'Domain registrar', 'domain_dns', 1499, 'yearly', '2026-11-02'),
  bill(3, '1Password', '1Password', 'software_tools', 700, 'monthly', '2026-11-09'),
  bill(4, 'Apify Starter', 'Apify', 'data_providers', 4900, 'monthly', '2026-11-03', 'Apify'),
  bill(
    5,
    'Firecrawl Hobby',
    'Firecrawl',
    'data_providers',
    1600,
    'monthly',
    '2026-11-04',
    'Firecrawl',
  ),
  {
    id: fid(0xf010),
    priceId: fid(0xf110),
    kind: 'one_off',
    name: 'Terms and privacy review',
    vendor: 'Legal counsel',
    category: 'legal_admin',
    cadence: null,
    startsOn: '2026-11-12',
    amountCents: 30000,
    coversProvider: null,
    link: null,
  },
];

/** Provider names as in the Tool catalog. */
export const DEMO_PROVIDER_INVOICES = [
  { provider: 'Anthropic', month: '2026-11', amountCents: 4410 },
  { provider: 'Google Maps Platform', month: '2026-11', amountCents: 1720 },
  { provider: 'ZeroBounce', month: '2026-11', amountCents: 480 },
] as const;

const DEMO_BUDGET_CENTS = 30000;
/** Month-to-date spend when the 12 November check ran (both thresholds crossed at once). */
const ALERT_SPENT_CENTS = 44_014;
const ALERT_SENT_AT = new Date('2026-11-12T14:00:00.000Z');
const ENTERED_AT = new Date('2026-11-19T10:00:00.000Z');

/**
 * Idempotent: fixed ids and keys, inserted with INSERT IGNORE, so a second run changes nothing
 * and Staff's later edits to these rows are kept.
 */
export async function seedFinanceDemo(db: Database, staffMemberId: string): Promise<void> {
  await db.transaction().execute(async (tx) => {
    for (const e of DEMO_EXPENSES) {
      const createdAt = new Date(`${e.startsOn}T09:00:00.000Z`);
      await tx
        .insertInto('expenses')
        .ignore()
        .values({
          id: e.id,
          kind: e.kind,
          name: e.name,
          vendor: e.vendor,
          category: e.category,
          cadence: e.cadence,
          starts_on: e.startsOn,
          ends_on: null,
          covers_provider: e.coversProvider,
          link: e.link,
          notes: null,
          created_by_member_id: staffMemberId,
          created_at: createdAt,
          updated_at: createdAt,
        })
        .execute();
      await tx
        .insertInto('expense_prices')
        .ignore()
        .values({
          id: e.priceId,
          expense_id: e.id,
          effective_from: e.startsOn,
          amount_cents: e.amountCents,
        })
        .execute();
    }

    for (const inv of DEMO_PROVIDER_INVOICES) {
      await tx
        .insertInto('provider_invoices')
        .ignore()
        .values({
          provider: inv.provider,
          month: inv.month,
          amount_cents: inv.amountCents,
          note: null,
          entered_by_member_id: staffMemberId,
          entered_at: ENTERED_AT,
          updated_at: ENTERED_AT,
        })
        .execute();
    }

    await tx
      .insertInto('finance_settings')
      .ignore()
      .values({
        id: 1,
        monthly_budget_cents: DEMO_BUDGET_CENTS,
        updated_by_member_id: null,
        updated_at: ALERT_SENT_AT,
      })
      .execute();
    await tx
      .insertInto('finance_budgets')
      .ignore()
      .values({ month: '2026-11', budget_cents: DEMO_BUDGET_CENTS, set_at: ALERT_SENT_AT })
      .execute();
    for (const threshold of [80, 100] as const) {
      await tx
        .insertInto('budget_alerts')
        .ignore()
        .values({
          month: '2026-11',
          threshold,
          spent_cents: ALERT_SPENT_CENTS,
          budget_cents: DEMO_BUDGET_CENTS,
          sent_at: ALERT_SENT_AT,
        })
        .execute();
    }
  });
}
