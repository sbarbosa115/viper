import type { Actor } from '../../../shared/domain/actor.js';
import { ValidationError } from '../../../shared/domain/errors.js';
import type { LedgerEntry, LedgerEntryType } from '../domain/ledger-entry.js';
import type {
  BillingReadModel,
  BillingUnitOfWork,
  CreditsSummary,
  LedgerCursor,
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

  /** Customer list columns (FR-31): available credits and paying, batched. */
  availableByBusiness(businessIds: readonly string[]): Promise<Map<string, number>> {
    return this.deps.readModel.availableByBusiness(businessIds);
  }

  payingBusinessIds(businessIds: readonly string[]): Promise<Set<string>> {
    return this.deps.readModel.payingBusinessIds(businessIds);
  }
}
