import { sql } from 'kysely';
import type { Database } from '../../../shared/infrastructure/db/database.js';
import type { BillingReadModel, CreditsSummary, MonthlyRevenue } from '../application/ports.js';

const n = (v: unknown) => Number(v ?? 0);

/** Aggregates for Staff reporting (FR-30, FR-31); each is one query, never per Business. */
export class KyselyBillingReadModel implements BillingReadModel {
  constructor(private readonly db: Database) {}

  async revenueBetween(range: { from: Date; to: Date }): Promise<MonthlyRevenue> {
    const [sales, refunds] = await Promise.all([
      this.db
        .selectFrom('purchases')
        .select(['id', 'amount_cents', 'tax_cents', 'paid_at'])
        .where('status', '=', 'paid')
        .where('paid_at', '>=', range.from)
        .where('paid_at', '<', range.to)
        .orderBy('paid_at')
        .orderBy('id')
        .execute(),
      this.db
        .selectFrom('purchase_refunds as r')
        .innerJoin('purchases as p', 'p.id', 'r.purchase_id')
        .select([
          'p.id as purchase_id',
          'p.amount_cents',
          'p.tax_cents',
          'r.delta_cents',
          'r.refunded_at',
        ])
        .where('r.refunded_at', '>=', range.from)
        .where('r.refunded_at', '<', range.to)
        .orderBy('r.refunded_at')
        .orderBy('r.id')
        .execute(),
    ]);
    return {
      sales: sales.flatMap((r) =>
        r.paid_at
          ? [
              {
                purchaseId: r.id,
                amountCents: r.amount_cents,
                taxCents: r.tax_cents,
                paidAt: r.paid_at,
              },
            ]
          : [],
      ),
      refunds: refunds.flatMap((r) =>
        r.refunded_at
          ? [
              {
                purchaseId: r.purchase_id,
                refundedCents: r.delta_cents,
                amountCents: r.amount_cents,
                taxCents: r.tax_cents,
                refundedAt: r.refunded_at,
              },
            ]
          : [],
      ),
    };
  }

  async creditsSummary(filter: {
    from: Date;
    to: Date;
    excludeBusinessIds: readonly string[];
  }): Promise<CreditsSummary> {
    const exclude = filter.excludeBusinessIds.length > 0 ? [...filter.excludeBusinessIds] : null;

    let ledger = this.db
      .selectFrom('credit_ledger')
      .select([
        sql<number>`COALESCE(SUM(CASE WHEN type = 'grant' OR (type = 'adjustment' AND credits > 0) THEN credits ELSE 0 END), 0)`.as(
          'granted',
        ),
        sql<number>`COALESCE(SUM(CASE WHEN type = 'purchase' THEN credits ELSE 0 END), 0)`.as(
          'purchased',
        ),
        sql<number>`COALESCE(-SUM(CASE WHEN type = 'settlement' THEN credits ELSE 0 END), 0)`.as(
          'spent',
        ),
      ])
      .where('created_at', '>=', filter.from)
      .where('created_at', '<', filter.to);
    let revenue = this.db
      .selectFrom('purchases')
      .select(sql<number>`COALESCE(SUM(amount_cents), 0)`.as('cents'))
      .where('status', '=', 'paid')
      .where('paid_at', '>=', filter.from)
      .where('paid_at', '<', filter.to);
    let balance = this.db
      .selectFrom('credit_ledger')
      .select(sql<number>`COALESCE(SUM(credits), 0)`.as('total'));
    let held = this.db
      .selectFrom('reservations')
      .select(sql<number>`COALESCE(SUM(credits), 0)`.as('total'))
      .where('status', '=', 'open');
    if (exclude) {
      ledger = ledger.where('business_id', 'not in', exclude);
      revenue = revenue.where('business_id', 'not in', exclude);
      balance = balance.where('business_id', 'not in', exclude);
      held = held.where('business_id', 'not in', exclude);
    }

    const [l, r, b, h] = await Promise.all([
      ledger.executeTakeFirst(),
      revenue.executeTakeFirst(),
      balance.executeTakeFirst(),
      held.executeTakeFirst(),
    ]);
    return {
      packRevenueCents: n(r?.cents),
      creditsGranted: n(l?.granted),
      creditsPurchased: n(l?.purchased),
      creditsSpent: n(l?.spent),
      unspentCredits: n(b?.total) - n(h?.total),
    };
  }

  async availableByBusiness(businessIds: readonly string[]): Promise<Map<string, number>> {
    const result = new Map(businessIds.map((id) => [id, 0]));
    if (businessIds.length === 0) return result;
    const ids = [...businessIds];
    const [balances, holds] = await Promise.all([
      this.db
        .selectFrom('credit_ledger')
        .select(['business_id', sql<number>`SUM(credits)`.as('total')])
        .where('business_id', 'in', ids)
        .groupBy('business_id')
        .execute(),
      this.db
        .selectFrom('reservations')
        .select(['business_id', sql<number>`SUM(credits)`.as('total')])
        .where('business_id', 'in', ids)
        .where('status', '=', 'open')
        .groupBy('business_id')
        .execute(),
    ]);
    for (const row of balances) result.set(row.business_id, n(row.total));
    for (const row of holds) {
      result.set(row.business_id, (result.get(row.business_id) ?? 0) - n(row.total));
    }
    return result;
  }

  async payingBusinessIds(
    businessIds: readonly string[],
    options?: { paidBefore?: Date },
  ): Promise<Set<string>> {
    if (businessIds.length === 0) return new Set();
    let q = this.db
      .selectFrom('purchases')
      .select('business_id')
      .distinct()
      .where('status', '=', 'paid')
      .where('business_id', 'in', [...businessIds]);
    if (options?.paidBefore) q = q.where('paid_at', '<', options.paidBefore);
    const rows = await q.execute();
    return new Set(rows.map((r) => r.business_id));
  }
}
