import { sql, type Kysely, type Transaction } from 'kysely';
import type { Clock } from '../../../shared/domain/clock.js';
import type { DB } from '../../../shared/infrastructure/db/schema.js';
import type { Outbox } from '../../../shared/infrastructure/outbox/index.js';
import type {
  BillingRepos,
  AuditRecorder,
  BillingUnitOfWork,
  CreditPackRepository,
  ExternalTransaction,
  LedgerRepository,
  PurchaseRefund,
  PurchaseRepository,
  ReservationRepository,
  WalletRepository,
} from '../application/ports.js';
import { CreditPack } from '../domain/credit-pack.js';
import type { LedgerEntry } from '../domain/ledger-entry.js';
import { Purchase } from '../domain/purchase.js';
import { Reservation } from '../domain/reservation.js';
import { Wallet } from '../domain/wallet.js';
import type { CreditLedgerTable } from './tables.js';

type Db = Kysely<DB> | Transaction<DB>;
type LedgerRow = Omit<CreditLedgerTable, 'created_at'> & { created_at: Date };

const sumCredits = sql<string | number | null>`COALESCE(SUM(credits), 0)`;
const num = (v: string | number | null | undefined) => Number(v ?? 0);

function isDuplicate(error: unknown, key: string): boolean {
  const e = error as { code?: string; message?: string };
  return e.code === 'ER_DUP_ENTRY' && (e.message ?? '').includes(key);
}

export class KyselyWalletRepository implements WalletRepository {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async lock(businessId: string): Promise<Wallet> {
    // INSERT … ON DUPLICATE KEY UPDATE takes an exclusive lock on the row whether or not it
    // existed, held until the transaction ends.
    await this.db
      .insertInto('credit_wallets')
      .values({ business_id: businessId, created_at: this.clock.now() })
      .onDuplicateKeyUpdate({ business_id: businessId })
      .execute();
    return this.read(businessId, true);
  }

  totals(businessId: string): Promise<Wallet> {
    return this.read(businessId, false);
  }

  /** Locking reads see the latest committed rows even inside a caller's older snapshot. */
  private async read(businessId: string, locking: boolean): Promise<Wallet> {
    let ledger = this.db
      .selectFrom('credit_ledger')
      .select(sumCredits.as('total'))
      .where('business_id', '=', businessId);
    let held = this.db
      .selectFrom('reservations')
      .select(sumCredits.as('total'))
      .where('business_id', '=', businessId)
      .where('status', '=', 'open');
    if (locking) {
      ledger = ledger.forShare();
      held = held.forShare();
    }
    const balance = await ledger.executeTakeFirst();
    const reserved = await held.executeTakeFirst();
    return Wallet.of({ businessId, balance: num(balance?.total), reserved: num(reserved?.total) });
  }
}

const toEntry = (r: LedgerRow): LedgerEntry => ({
  id: r.id,
  businessId: r.business_id,
  type: r.type,
  credits: r.credits,
  description: r.description,
  runId: r.run_id,
  purchaseId: r.purchase_id,
  idempotencyKey: r.idempotency_key,
  createdByMemberId: r.created_by_member_id,
  createdAt: r.created_at,
});

export class KyselyLedgerRepository implements LedgerRepository {
  constructor(private readonly db: Db) {}

  async append(e: LedgerEntry): Promise<boolean> {
    try {
      await this.db
        .insertInto('credit_ledger')
        .values({
          id: e.id,
          business_id: e.businessId,
          type: e.type,
          credits: e.credits,
          description: e.description,
          run_id: e.runId,
          purchase_id: e.purchaseId,
          idempotency_key: e.idempotencyKey,
          created_by_member_id: e.createdByMemberId,
          created_at: e.createdAt,
        })
        .execute();
      return true;
    } catch (error) {
      if (isDuplicate(error, 'credit_ledger_idempotency_key')) return false;
      throw error;
    }
  }

  async findByIdempotencyKey(key: string): Promise<LedgerEntry | null> {
    const row = await this.db
      .selectFrom('credit_ledger')
      .selectAll()
      .where('idempotency_key', '=', key)
      .executeTakeFirst();
    return row ? toEntry(row) : null;
  }

  async list(
    businessId: string,
    page: { after?: { createdAt: Date; id: string }; limit: number },
  ): Promise<LedgerEntry[]> {
    let q = this.db
      .selectFrom('credit_ledger')
      .selectAll()
      .where('business_id', '=', businessId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(page.limit);
    const after = page.after;
    if (after) {
      q = q.where((eb) =>
        eb.or([
          eb('created_at', '<', after.createdAt),
          eb.and([eb('created_at', '=', after.createdAt), eb('id', '<', after.id)]),
        ]),
      );
    }
    return (await q.execute()).map(toEntry);
  }

  async chargedForRun(runId: string): Promise<number> {
    const row = await this.db
      .selectFrom('credit_ledger')
      .select(sumCredits.as('total'))
      .where('run_id', '=', runId)
      .where('type', '=', 'settlement')
      .executeTakeFirst();
    return -num(row?.total);
  }
}

export class KyselyReservationRepository implements ReservationRepository {
  constructor(private readonly db: Db) {}

  find(runId: string): Promise<Reservation | null> {
    return this.load(runId, false);
  }

  findForUpdate(runId: string): Promise<Reservation | null> {
    return this.load(runId, true);
  }

  async save(reservation: Reservation): Promise<void> {
    const s = reservation.toSnapshot();
    await this.db
      .insertInto('reservations')
      .values({
        run_id: s.runId,
        business_id: s.businessId,
        credits: s.credits,
        status: s.status,
        created_at: s.createdAt,
        closed_at: s.closedAt,
      })
      .onDuplicateKeyUpdate({ credits: s.credits, status: s.status, closed_at: s.closedAt })
      .execute();
  }

  private async load(runId: string, locking: boolean): Promise<Reservation | null> {
    let q = this.db.selectFrom('reservations').selectAll().where('run_id', '=', runId);
    if (locking) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    return row
      ? Reservation.restore({
          runId: row.run_id,
          businessId: row.business_id,
          credits: row.credits,
          status: row.status,
          createdAt: row.created_at,
          closedAt: row.closed_at,
        })
      : null;
  }
}

export class KyselyCreditPackRepository implements CreditPackRepository {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async list(filter: { activeOnly: boolean }): Promise<CreditPack[]> {
    let q = this.db.selectFrom('credit_packs').selectAll().orderBy('position').orderBy('name');
    if (filter.activeOnly) q = q.where('active', '=', 1);
    return (await q.execute()).map(toPack);
  }

  async findById(id: string): Promise<CreditPack | null> {
    const row = await this.db
      .selectFrom('credit_packs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toPack(row) : null;
  }

  async findByName(name: string): Promise<CreditPack | null> {
    const row = await this.db
      .selectFrom('credit_packs')
      .selectAll()
      .where('name', '=', name)
      .orderBy('position')
      .executeTakeFirst();
    return row ? toPack(row) : null;
  }

  async nextPosition(): Promise<number> {
    const row = await this.db
      .selectFrom('credit_packs')
      .select(sql<number | null>`MAX(position)`.as('max'))
      .executeTakeFirst();
    return row?.max === null || row?.max === undefined ? 0 : Number(row.max) + 1;
  }

  async save(pack: CreditPack): Promise<void> {
    const s = pack.toSnapshot();
    const now = this.clock.now();
    await this.db
      .insertInto('credit_packs')
      .values({
        id: s.id,
        name: s.name,
        credits: s.credits,
        price_cents: s.priceCents,
        active: s.active,
        position: s.position,
        created_at: now,
        updated_at: now,
      })
      .onDuplicateKeyUpdate({
        name: s.name,
        credits: s.credits,
        price_cents: s.priceCents,
        active: s.active,
        position: s.position,
        updated_at: now,
      })
      .execute();
  }
}

function toPack(row: {
  id: string;
  name: string;
  credits: number;
  price_cents: number;
  active: number;
  position: number;
}): CreditPack {
  return CreditPack.restore({
    id: row.id,
    name: row.name,
    credits: row.credits,
    priceCents: row.price_cents,
    active: Boolean(row.active),
    position: row.position,
  });
}

export class KyselyPurchaseRepository implements PurchaseRepository {
  constructor(private readonly db: Db) {}

  findBySessionIdForUpdate(sessionId: string): Promise<Purchase | null> {
    return this.findForUpdate('stripe_session_id', sessionId);
  }

  findByPaymentIntentIdForUpdate(paymentIntentId: string): Promise<Purchase | null> {
    return this.findForUpdate('stripe_payment_intent_id', paymentIntentId);
  }

  private async findForUpdate(
    column: 'stripe_session_id' | 'stripe_payment_intent_id',
    value: string,
  ): Promise<Purchase | null> {
    const row = await this.db
      .selectFrom('purchases')
      .selectAll()
      .where(column, '=', value)
      .forUpdate()
      .executeTakeFirst();
    return row
      ? Purchase.restore({
          id: row.id,
          businessId: row.business_id,
          packId: row.pack_id,
          credits: row.credits,
          stripeSessionId: row.stripe_session_id,
          stripeEventId: row.stripe_event_id,
          stripePaymentIntentId: row.stripe_payment_intent_id,
          amountCents: row.amount_cents,
          taxCents: row.tax_cents,
          refundedCents: row.refunded_cents,
          status: row.status,
          createdAt: row.created_at,
          paidAt: row.paid_at,
          refundedAt: row.refunded_at,
        })
      : null;
  }

  async addRefund(refund: PurchaseRefund): Promise<boolean> {
    const result = await this.db
      .insertInto('purchase_refunds')
      .ignore()
      .values({
        id: refund.id,
        purchase_id: refund.purchaseId,
        stripe_event_id: refund.stripeEventId,
        delta_cents: refund.deltaCents,
        refunded_at: refund.refundedAt,
      })
      .executeTakeFirst();
    return Number(result.numInsertedOrUpdatedRows ?? 0) > 0;
  }

  async save(purchase: Purchase): Promise<void> {
    const s = purchase.toSnapshot();
    await this.db
      .insertInto('purchases')
      .values({
        id: s.id,
        business_id: s.businessId,
        pack_id: s.packId,
        credits: s.credits,
        stripe_session_id: s.stripeSessionId,
        stripe_event_id: s.stripeEventId,
        stripe_payment_intent_id: s.stripePaymentIntentId,
        amount_cents: s.amountCents,
        tax_cents: s.taxCents,
        refunded_cents: s.refundedCents,
        status: s.status,
        created_at: s.createdAt,
        paid_at: s.paidAt,
        refunded_at: s.refundedAt,
      })
      .onDuplicateKeyUpdate({
        stripe_event_id: s.stripeEventId,
        stripe_payment_intent_id: s.stripePaymentIntentId,
        tax_cents: s.taxCents,
        refunded_cents: s.refundedCents,
        status: s.status,
        paid_at: s.paidAt,
        refunded_at: s.refundedAt,
      })
      .execute();
  }
}

const DEADLOCK = 'ER_LOCK_DEADLOCK';
const MAX_TRIES = 3;

/**
 * Billing's Unit of Work. Joins a caller's transaction when given one (research reserves in the
 * same transaction that creates the run, FR-18); otherwise opens its own and retries deadlocks.
 */
export class KyselyBillingUnitOfWork implements BillingUnitOfWork {
  constructor(
    private readonly db: Kysely<DB>,
    private readonly clock: Clock,
    private readonly outbox: Outbox,
    private readonly audit: AuditRecorder,
  ) {}

  async run<T>(fn: (repos: BillingRepos) => Promise<T>, within?: ExternalTransaction): Promise<T> {
    if (within) return fn(this.repos(within as Transaction<DB>));
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.db.transaction().execute((trx) => fn(this.repos(trx)));
      } catch (error) {
        if ((error as { code?: string }).code !== DEADLOCK || attempt >= MAX_TRIES) throw error;
      }
    }
  }

  private repos(trx: Transaction<DB>): BillingRepos {
    return {
      wallets: new KyselyWalletRepository(trx, this.clock),
      ledger: new KyselyLedgerRepository(trx),
      reservations: new KyselyReservationRepository(trx),
      packs: new KyselyCreditPackRepository(trx, this.clock),
      purchases: new KyselyPurchaseRepository(trx),
      events: { publish: (type, payload) => this.outbox.add(trx, type, payload) },
      audit: { record: (entry) => this.audit.record(entry, trx) },
    };
  }
}
