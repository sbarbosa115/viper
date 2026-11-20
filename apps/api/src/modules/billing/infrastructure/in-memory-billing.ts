import { CreditPack, type CreditPackSnapshot } from '../domain/credit-pack.js';
import type { LedgerEntry } from '../domain/ledger-entry.js';
import { Purchase, type PurchaseSnapshot } from '../domain/purchase.js';
import { Reservation, type ReservationSnapshot } from '../domain/reservation.js';
import { Wallet } from '../domain/wallet.js';
import type {
  AuditRecorder,
  BillingEvents,
  BillingReadModel,
  BillingRepos,
  BillingUnitOfWork,
  BusinessDirectory,
  CreditsSummary,
  LedgerCursor,
  TrialCreditsSetting,
} from '../application/ports.js';

/** Rows as the database would hold them; cloned in and out so unsaved changes are lost. */
export interface BillingState {
  ledger: LedgerEntry[];
  reservations: ReservationSnapshot[];
  packs: CreditPackSnapshot[];
  purchases: PurchaseSnapshot[];
  events: { type: keyof BillingEvents; payload: BillingEvents[keyof BillingEvents] }[];
}

const newer = (a: LedgerCursor, b: LedgerCursor) =>
  a.createdAt.getTime() !== b.createdAt.getTime()
    ? a.createdAt.getTime() > b.createdAt.getTime()
    : a.id > b.id;

/**
 * In-memory billing storage (tests, and other modules' tests via createInMemoryBilling). BillingUnitOfWork: transactions run one at a time (like the wallet lock) and roll
 * back on error.
 */
export class InMemoryBilling implements BillingUnitOfWork, BillingReadModel {
  state: BillingState = { ledger: [], reservations: [], packs: [], purchases: [], events: [] };
  private queue: Promise<unknown> = Promise.resolve();

  /** `audit` receives the Audit entries written inside a transaction (a failed write rolls back). */
  constructor(private readonly audit: AuditRecorder = new RecordingAuditRecorder()) {}

  run<T>(fn: (repos: BillingRepos) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const before = structuredClone(this.state);
      try {
        return await fn(this.repos());
      } catch (error) {
        this.state = before;
        throw error;
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  totals(businessId: string): Wallet {
    return Wallet.of({
      businessId,
      balance: this.state.ledger
        .filter((e) => e.businessId === businessId)
        .reduce((s, e) => s + e.credits, 0),
      reserved: this.state.reservations
        .filter((r) => r.businessId === businessId && r.status === 'open')
        .reduce((s, r) => s + r.credits, 0),
    });
  }

  creditsSummary(filter: {
    from: Date;
    to: Date;
    excludeBusinessIds: readonly string[];
  }): Promise<CreditsSummary> {
    const inPeriod = (d: Date) => d >= filter.from && d < filter.to;
    const counted = (b: string) => !filter.excludeBusinessIds.includes(b);
    const entries = this.state.ledger.filter((e) => counted(e.businessId) && inPeriod(e.createdAt));
    const sum = (pred: (e: LedgerEntry) => boolean) =>
      entries.filter(pred).reduce((s, e) => s + e.credits, 0);
    const businesses = new Set(this.state.ledger.map((e) => e.businessId).filter(counted));
    return Promise.resolve({
      packRevenueCents: this.state.purchases
        .filter(
          (p) => p.status === 'paid' && p.paidAt && inPeriod(p.paidAt) && counted(p.businessId),
        )
        .reduce((s, p) => s + p.amountCents, 0),
      creditsGranted: sum((e) => e.type === 'grant' || (e.type === 'adjustment' && e.credits > 0)),
      creditsPurchased: sum((e) => e.type === 'purchase'),
      creditsSpent: -sum((e) => e.type === 'settlement'),
      unspentCredits: [...businesses].reduce((s, b) => s + this.totals(b).available, 0),
    });
  }

  availableByBusiness(businessIds: readonly string[]): Promise<Map<string, number>> {
    return Promise.resolve(new Map(businessIds.map((b) => [b, this.totals(b).available])));
  }

  payingBusinessIds(
    businessIds: readonly string[],
    options?: { paidBefore?: Date },
  ): Promise<Set<string>> {
    const before = options?.paidBefore;
    return Promise.resolve(
      new Set(
        this.state.purchases
          .filter(
            (p) =>
              p.status === 'paid' &&
              businessIds.includes(p.businessId) &&
              (!before || (p.paidAt !== null && p.paidAt < before)),
          )
          .map((p) => p.businessId),
      ),
    );
  }

  private repos(): BillingRepos {
    const s = () => this.state;
    return {
      wallets: {
        lock: (businessId) => Promise.resolve(this.totals(businessId)),
        totals: (businessId) => Promise.resolve(this.totals(businessId)),
      },
      ledger: {
        append: (entry) => {
          if (
            entry.idempotencyKey &&
            s().ledger.some((e) => e.idempotencyKey === entry.idempotencyKey)
          ) {
            return Promise.resolve(false);
          }
          s().ledger.push(structuredClone(entry));
          return Promise.resolve(true);
        },
        findByIdempotencyKey: (key) =>
          Promise.resolve(
            structuredClone(s().ledger.find((e) => e.idempotencyKey === key) ?? null),
          ),
        list: (businessId, page) =>
          Promise.resolve(
            s()
              .ledger.filter((e) => e.businessId === businessId)
              .filter((e) => !page.after || newer(page.after, e))
              .sort((a, b) => (newer(a, b) ? -1 : 1))
              .slice(0, page.limit)
              .map((e) => structuredClone(e)),
          ),
        chargedForRun: (runId) =>
          Promise.resolve(
            -s()
              .ledger.filter((e) => e.runId === runId && e.type === 'settlement')
              .reduce((sum, e) => sum + e.credits, 0),
          ),
      },
      reservations: {
        find: (runId) => this.findReservation(runId),
        findForUpdate: (runId) => this.findReservation(runId),
        save: (r) => {
          const snap = r.toSnapshot();
          s().reservations = [...s().reservations.filter((x) => x.runId !== snap.runId), snap];
          return Promise.resolve();
        },
      },
      packs: {
        list: ({ activeOnly }) =>
          Promise.resolve(
            s()
              .packs.filter((p) => !activeOnly || p.active)
              .sort((a, b) => a.position - b.position)
              .map((p) => CreditPack.restore(structuredClone(p))),
          ),
        findById: (id) => this.findPack((p) => p.id === id),
        findByName: (name) => this.findPack((p) => p.name === name),
        nextPosition: () =>
          Promise.resolve(s().packs.reduce((max, p) => Math.max(max, p.position + 1), 0)),
        save: (pack) => {
          const snap = pack.toSnapshot();
          s().packs = [...s().packs.filter((p) => p.id !== snap.id), snap];
          return Promise.resolve();
        },
      },
      purchases: {
        findBySessionIdForUpdate: (sessionId) => {
          const found = s().purchases.find((p) => p.stripeSessionId === sessionId);
          return Promise.resolve(found ? Purchase.restore(structuredClone(found)) : null);
        },
        save: (purchase) => {
          const snap = purchase.toSnapshot();
          s().purchases = [...s().purchases.filter((p) => p.id !== snap.id), snap];
          return Promise.resolve();
        },
      },
      events: {
        publish: (type, payload) => {
          s().events.push({ type, payload: structuredClone(payload) });
          return Promise.resolve();
        },
      },
      audit: { record: (entry) => this.audit.record(entry) },
    };
  }

  private findReservation(runId: string): Promise<Reservation | null> {
    const found = this.state.reservations.find((r) => r.runId === runId);
    return Promise.resolve(found ? Reservation.restore(structuredClone(found)) : null);
  }

  private findPack(pred: (p: CreditPackSnapshot) => boolean): Promise<CreditPack | null> {
    const found = this.state.packs.find(pred);
    return Promise.resolve(found ? CreditPack.restore(structuredClone(found)) : null);
  }
}

export class RecordingAuditRecorder implements AuditRecorder {
  readonly entries: Parameters<AuditRecorder['record']>[0][] = [];
  /** The next write fails with this error (to test that it rolls its transaction back). */
  failNext: Error | null = null;
  record(entry: Parameters<AuditRecorder['record']>[0]): Promise<void> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      return Promise.reject(error);
    }
    this.entries.push(entry);
    return Promise.resolve();
  }
}

export class StaticBusinessDirectory implements BusinessDirectory {
  constructor(private readonly ids: readonly string[]) {}
  exists(businessId: string): Promise<boolean> {
    return Promise.resolve(this.ids.includes(businessId));
  }
}

/** Until identity answers, every Business id is accepted. */
export class AnyBusinessDirectory implements BusinessDirectory {
  exists(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

/** A fixed trial grant (FR-11 default 50) until platform's ceilings are wired. */
export class FixedTrialCredits implements TrialCreditsSetting {
  constructor(private readonly credits = 50) {}
  trialCredits(): Promise<number> {
    return Promise.resolve(this.credits);
  }
}
