import type { Actor } from '../../../shared/domain/actor.js';
import { ValidationError } from '../../../shared/domain/errors.js';
import type { LedgerEntry, LedgerEntryType } from '../domain/ledger-entry.js';
import type {
  BillingReadModel,
  BillingUnitOfWork,
  CreditsSummary,
  LedgerCursor,
  MonthlyRevenue,
  PaymentGateway,
} from './ports.js';

export interface WalletView {
  businessId: string;
  balance: number;
  reserved: number;
  available: number;
}

export interface LedgerEntryView {
  id: string;
  type: LedgerEntryType;
  credits: number;
  description: string;
  runId: string | null;
  createdAt: string;
}

export interface CreditsPageView {
  balance: number;
  reserved: number;
  available: number;
  packs: { id: string; name: string; credits: number; price: { cents: number; currency: 'usd' } }[];
  paymentsAvailable: boolean;
}

export interface ActivePackView {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
}

export const toLedgerEntryView = (e: LedgerEntry): LedgerEntryView => ({
  id: e.id,
  type: e.type,
  credits: e.credits,
  description: e.description,
  runId: e.runId,
  createdAt: e.createdAt.toISOString(),
});

export function encodeCursor(c: LedgerCursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`).toString('base64url');
}

export function decodeCursor(cursor: string): LedgerCursor {
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(at ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) {
    throw new ValidationError('Invalid cursor', { cursor: 'Invalid cursor' });
  }
  return { createdAt, id };
}

interface Deps {
  uow: BillingUnitOfWork;
  gateway: PaymentGateway;
  readModel: BillingReadModel;
}

/** Reads of the Credit wallet (FR-10) and Staff reporting figures. */
export class WalletQueries {
  constructor(private readonly deps: Deps) {}

  getWallet(businessId: string): Promise<WalletView> {
    return this.deps.uow.run(async ({ wallets }) => {
      const w = await wallets.totals(businessId);
      return { businessId, balance: w.balance, reserved: w.reserved, available: w.available };
    });
  }

  /** GET /api/credits: totals, active packs and whether Stripe is set up. */
  async creditsPage(actor: Actor): Promise<CreditsPageView> {
    const [wallet, packs, paymentsAvailable] = await Promise.all([
      this.getWallet(actor.businessId),
      this.deps.uow.run(({ packs }) => packs.list({ activeOnly: true })),
      this.deps.gateway.isAvailable(),
    ]);
    return {
      balance: wallet.balance,
      reserved: wallet.reserved,
      available: wallet.available,
      packs: packs.map((p) => ({
        id: p.id,
        name: p.name,
        credits: p.credits,
        price: { cents: p.priceCents, currency: 'usd' },
      })),
      paymentsAvailable,
    };
  }

  /** The public site's pricing (FR-34): active packs in their Staff-set order, no Stripe check. */
  activePacks(): Promise<ActivePackView[]> {
    return this.deps.uow.run(async ({ packs }) =>
      (await packs.list({ activeOnly: true })).map((p) => ({
        id: p.id,
        name: p.name,
        credits: p.credits,
        priceCents: p.priceCents,
      })),
    );
  }

  /** GET /api/credits/ledger: newest first, cursor pagination. */
  ledger(
    actor: Actor,
    page: { cursor?: string | undefined; limit: number },
  ): Promise<{ items: LedgerEntryView[]; nextCursor: string | null }> {
    return this.deps.uow.run(async ({ ledger }) => {
      const after = page.cursor ? decodeCursor(page.cursor) : undefined;
      const rows = await ledger.list(actor.businessId, {
        ...(after ? { after } : {}),
        limit: page.limit + 1,
      });
      const items = rows.slice(0, page.limit);
      const last = items.at(-1);
      const nextCursor =
        rows.length > page.limit && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null;
      return { items: items.map(toLedgerEntryView), nextCursor };
    });
  }

  /** Staff dashboard revenue and credit tiles (FR-30). */
  creditsSummary(filter: {
    from: Date;
    to: Date;
    excludeBusinessIds?: readonly string[];
  }): Promise<CreditsSummary> {
    return this.deps.readModel.creditsSummary({
      from: filter.from,
      to: filter.to,
      excludeBusinessIds: filter.excludeBusinessIds ?? [],
    });
  }

  /**
   * Sales (paid in the UTC month) and refunds (refunded in it), raw for finance. `month` is
   * 'YYYY-MM'.
   */
  async revenueForMonth(month: string): Promise<MonthlyRevenue> {
    const { year, index } = parseMonth(month);
    return await this.deps.readModel.revenueBetween({
      from: new Date(Date.UTC(year, index, 1)),
      to: new Date(Date.UTC(year, index + 1, 1)),
    });
  }

  /**
   * `revenueForMonth` for every UTC month from `fromMonth` to `toMonth` ('YYYY-MM', inclusive),
   * oldest first, empty months included: one query for sales and one for refunds over the range
   * (the P&L reads 12 months at once).
   */
  async revenueForMonths(
    fromMonth: string,
    toMonth: string,
  ): Promise<
    { month: string; sales: MonthlyRevenue['sales']; refunds: MonthlyRevenue['refunds'] }[]
  > {
    const first = parseMonth(fromMonth);
    const last = parseMonth(toMonth);
    const count = (last.year - first.year) * 12 + (last.index - first.index) + 1;
    if (count < 1 || count > MAX_MONTHS_PER_RANGE) {
      throw new ValidationError('Invalid month range', {
        month: `From must not be after to, at most ${MAX_MONTHS_PER_RANGE} months`,
      });
    }
    const buckets = Array.from({ length: count }, (_, i) => {
      const start = new Date(Date.UTC(first.year, first.index + i, 1));
      return {
        month: start.toISOString().slice(0, 7),
        sales: [] as MonthlyRevenue['sales'],
        refunds: [] as MonthlyRevenue['refunds'],
      };
    });
    const bucketOf = (at: Date) =>
      buckets[(at.getUTCFullYear() - first.year) * 12 + (at.getUTCMonth() - first.index)];
    const { sales, refunds } = await this.deps.readModel.revenueBetween({
      from: new Date(Date.UTC(first.year, first.index, 1)),
      to: new Date(Date.UTC(last.year, last.index + 1, 1)),
    });
    for (const s of sales) bucketOf(s.paidAt)?.sales.push(s);
    for (const r of refunds) bucketOf(r.refundedAt)?.refunds.push(r);
    return buckets;
  }

  /** Customer list columns (FR-31): available credits and paying, batched. */
  availableByBusiness(businessIds: readonly string[]): Promise<Map<string, number>> {
    return this.deps.readModel.availableByBusiness(businessIds);
  }

  /** `paidBefore`: paying as of that time (the dashboard's previous period). */
  payingBusinessIds(
    businessIds: readonly string[],
    options?: { paidBefore?: Date },
  ): Promise<Set<string>> {
    return this.deps.readModel.payingBusinessIds(businessIds, options);
  }
}

const MAX_MONTHS_PER_RANGE = 120;

/** 'YYYY-MM' to a year and zero-based month index. */
function parseMonth(month: string): { year: number; index: number } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new ValidationError('Invalid month', { month: 'Use YYYY-MM' });
  return { year: Number(match[1]), index: Number(match[2]) - 1 };
}
