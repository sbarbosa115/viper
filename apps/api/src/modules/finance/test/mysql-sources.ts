import { sql } from 'kysely';
import type { Database } from '../../../shared/infrastructure/db/database.js';
import type { FinanceSources } from '../application/ports.js';
import { monthBounds, monthOfInstant, monthRange } from '../domain/calendar.js';

/**
 * Test-only stand-ins for billing's revenueForMonths, tools' meteredCostByProviderMonths and
 * providers, and identity's Member emails, reading the seeded tables directly with the same query
 * shape as the owning modules (one query for sales, one for refund rows, one grouped query for
 * Tool cost by month and Tool). Production wires the owning modules' public functions instead
 * (composition.ts); never used outside finance's tests.
 */
export function mysqlSources(db: Database): FinanceSources {
  const toolProviders = async () =>
    new Map(
      (await db.selectFrom('tools').select(['key', 'provider']).execute()).map((t) => [
        t.key,
        t.provider,
      ]),
    );
  return {
    billing: {
      async revenueForMonths(fromMonth, toMonth) {
        const start = monthBounds(fromMonth).start;
        const end = monthBounds(toMonth).end;
        const [sales, refunds] = await Promise.all([
          db
            .selectFrom('purchases')
            .select(['id', 'amount_cents', 'tax_cents', 'paid_at'])
            .where('status', '=', 'paid')
            .where('paid_at', '>=', start)
            .where('paid_at', '<', end)
            .orderBy('paid_at')
            .execute(),
          db
            .selectFrom('purchase_refunds as r')
            .innerJoin('purchases as p', 'p.id', 'r.purchase_id')
            .select(['p.id', 'p.amount_cents', 'p.tax_cents', 'r.delta_cents', 'r.refunded_at'])
            .where('r.refunded_at', '>=', start)
            .where('r.refunded_at', '<', end)
            .orderBy('r.refunded_at')
            .execute(),
        ]);
        return monthRange(fromMonth, toMonth).map((month) => ({
          month,
          sales: sales
            .filter((s) => s.paid_at && monthOfInstant(s.paid_at) === month)
            .map((s) => ({
              purchaseId: s.id,
              amountCents: s.amount_cents,
              taxCents: s.tax_cents,
              paidAt: s.paid_at!,
            })),
          refunds: refunds
            .filter((r) => monthOfInstant(r.refunded_at) === month)
            .map((r) => ({
              purchaseId: r.id,
              refundedCents: r.delta_cents,
              amountCents: r.amount_cents,
              taxCents: r.tax_cents,
              refundedAt: r.refunded_at,
            })),
        }));
      },
    },
    tools: {
      async meteredCostByProviderMonths(fromMonth, toMonth) {
        const month = sql<string>`DATE_FORMAT(created_at, '%Y-%m')`;
        const [rows, providerOf] = await Promise.all([
          db
            .selectFrom('tool_calls')
            .select([
              'tool_key',
              month.as('month'),
              (eb) => eb.fn.sum<number>('provider_cost_micros').as('micros'),
            ])
            .where('created_at', '>=', monthBounds(fromMonth).start)
            .where('created_at', '<', monthBounds(toMonth).end)
            .groupBy(['tool_key', month])
            .execute(),
          toolProviders(),
        ]);
        const sums = new Map<string, { month: string; provider: string; micros: number }>();
        for (const r of rows) {
          const provider = providerOf.get(r.tool_key);
          if (!provider) continue;
          const key = `${r.month}|${provider}`;
          const prev = sums.get(key) ?? { month: r.month, provider, micros: 0 };
          sums.set(key, { ...prev, micros: prev.micros + Number(r.micros) });
        }
        return [...sums.values()].filter((s) => s.micros > 0);
      },
      async providers() {
        const by = new Map<string, string[]>();
        for (const [key, provider] of await toolProviders()) {
          by.set(provider, [...(by.get(provider) ?? []), key]);
        }
        return [...by].map(([name, toolKeys]) => ({ name, toolKeys }));
      },
    },
    staff: { staffRecipients: () => Promise.resolve([]) },
    members: {
      async memberEmails(ids) {
        if (ids.length === 0) return new Map();
        const rows = await db
          .selectFrom('members')
          .select(['id', 'email'])
          .where('id', 'in', [...ids])
          .execute();
        return new Map(rows.map((r) => [r.id, r.email]));
      },
    },
  };
}
