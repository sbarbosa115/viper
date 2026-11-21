import { sql } from 'kysely';
import type { Database } from '../../../shared/infrastructure/db/database.js';
import type { FinanceSources } from '../application/ports.js';
import { monthBounds } from '../domain/calendar.js';

/**
 * Test-only stand-ins for billing's revenueForMonth, tools' meteredCostByProvider and providers,
 * and identity's Member emails, reading the seeded tables directly. Production wires the owning
 * modules' public functions instead (composition.ts); never used outside finance's tests.
 */
export function mysqlSources(db: Database): FinanceSources {
  return {
    billing: {
      async revenueForMonth(month) {
        const { start, end } = monthBounds(month);
        const sales = await db
          .selectFrom('purchases')
          .select(['id', 'amount_cents', 'tax_cents', 'paid_at'])
          .where('status', '=', 'paid')
          .where('paid_at', '>=', start)
          .where('paid_at', '<', end)
          .execute();
        const refunds = await db
          .selectFrom('purchases')
          .select(['id', 'amount_cents', 'tax_cents', 'refunded_cents', 'refunded_at'])
          .where('refunded_cents', '>', 0)
          .where('refunded_at', '>=', start)
          .where('refunded_at', '<', end)
          .execute();
        return {
          sales: sales.map((s) => ({
            purchaseId: s.id,
            amountCents: s.amount_cents,
            taxCents: s.tax_cents,
            paidAt: s.paid_at!,
          })),
          refunds: refunds.map((r) => ({
            purchaseId: r.id,
            refundedCents: r.refunded_cents,
            amountCents: r.amount_cents,
            taxCents: r.tax_cents,
            refundedAt: r.refunded_at!,
          })),
        };
      },
    },
    tools: {
      async meteredCostByProvider(month) {
        const { start, end } = monthBounds(month);
        const rows = await db
          .selectFrom('tool_calls')
          .innerJoin('tools', 'tools.key', 'tool_calls.tool_key')
          .select([
            'tools.provider',
            sql<string>`SUM(tool_calls.provider_cost_micros)`.as('micros'),
          ])
          .where('tool_calls.created_at', '>=', start)
          .where('tool_calls.created_at', '<', end)
          .groupBy('tools.provider')
          .execute();
        return rows.map((r) => ({ provider: r.provider, micros: Number(r.micros) }));
      },
      async providers() {
        const rows = await db.selectFrom('tools').select(['key', 'provider']).execute();
        const by = new Map<string, string[]>();
        for (const r of rows) by.set(r.provider, [...(by.get(r.provider) ?? []), r.key]);
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
