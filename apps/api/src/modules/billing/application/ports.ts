import type { EventPublisher } from '../../../shared/application/event-publisher.js';
import type { CreditPack } from '../domain/credit-pack.js';
import type { LedgerEntry } from '../domain/ledger-entry.js';
import type { Purchase } from '../domain/purchase.js';
import type { Reservation } from '../domain/reservation.js';
import type { Wallet } from '../domain/wallet.js';

// Repositories -----------------------------------------------------------------------------------

export interface WalletRepository {
  /**
   * Locks the Business's wallet until the transaction ends and returns its current totals. Every
   * write to a Business's ledger or Reservations takes this lock first, so totals read under it
   * are exact and concurrent reserves can't overspend.
   */
  lock(businessId: string): Promise<Wallet>;
  /** Current totals without locking (for reads). */
  totals(businessId: string): Promise<Wallet>;
}

/** Position in the newest-first ledger list. */
export interface LedgerCursor {
  createdAt: Date;
  id: string;
}

export interface LedgerRepository {
  /** Appends an entry. Returns false (and writes nothing) when its idempotency key exists. */
  append(entry: LedgerEntry): Promise<boolean>;
  findByIdempotencyKey(key: string): Promise<LedgerEntry | null>;
  /** Newest first, entries strictly after `after`. */
  list(businessId: string, page: { after?: LedgerCursor; limit: number }): Promise<LedgerEntry[]>;
  /** Credits already charged to a run (sum of its Settlement entries, as a positive number). */
  chargedForRun(runId: string): Promise<number>;
}

export interface ReservationRepository {
  /** Reads without locking (to find the Business before taking the wallet lock). */
  find(runId: string): Promise<Reservation | null>;
  /** Reads with a row lock (call after locking the wallet). */
  findForUpdate(runId: string): Promise<Reservation | null>;
  save(reservation: Reservation): Promise<void>;
}

export interface CreditPackRepository {
  list(filter: { activeOnly: boolean }): Promise<CreditPack[]>;
  findById(id: string): Promise<CreditPack | null>;
  findByName(name: string): Promise<CreditPack | null>;
  nextPosition(): Promise<number>;
  save(pack: CreditPack): Promise<void>;
}

export interface PurchaseRepository {
  findBySessionIdForUpdate(sessionId: string): Promise<Purchase | null>;
  save(purchase: Purchase): Promise<void>;
}

/** Outbox events billing publishes (a subset of the shared outbox event map). */
export interface BillingEvents {
  CreditPackPurchased: {
    purchaseId: string;
    businessId: string;
    packId: string;
    credits: number;
    amountCents: number;
  };
}

/** An Audit log entry (FR-7). */
export interface AuditEntry {
  staffMemberId: string;
  businessId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown>;
}

export interface BillingRepos {
  wallets: WalletRepository;
  ledger: LedgerRepository;
  reservations: ReservationRepository;
  packs: CreditPackRepository;
  purchases: PurchaseRepository;
  events: EventPublisher<BillingEvents>;
  /** The Audit log, bound to the transaction: a Staff change and its entry commit together. */
  audit: { record(entry: AuditEntry): Promise<void> };
}

/** Opaque handle to a caller's open transaction (research reserves inside its own, FR-18). */
export type ExternalTransaction = object;

export interface BillingUnitOfWork {
  /** Runs `fn` in a new transaction, or inside `within` when the caller already has one. */
  run<T>(fn: (repos: BillingRepos) => Promise<T>, within?: ExternalTransaction): Promise<T>;
}

// Read model for Staff reporting -----------------------------------------------------------------

export interface CreditsSummary {
  packRevenueCents: number;
  creditsGranted: number;
  creditsPurchased: number;
  creditsSpent: number;
  /** Available credits across all Businesses now (not limited to the period). */
  unspentCredits: number;
}

export interface BillingReadModel {
  creditsSummary(filter: {
    from: Date;
    to: Date;
    excludeBusinessIds: readonly string[];
  }): Promise<CreditsSummary>;
  availableByBusiness(businessIds: readonly string[]): Promise<Map<string, number>>;
  /** Businesses with a paid purchase; `paidBefore` counts only purchases paid before it. */
  payingBusinessIds(
    businessIds: readonly string[],
    options?: { paidBefore?: Date },
  ): Promise<Set<string>>;
}

// Other ports ------------------------------------------------------------------------------------

export interface CheckoutRequest {
  businessId: string;
  packId: string;
  packName: string;
  credits: number;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  sessionId: string;
  url: string;
}

/** A verified Stripe webhook event, reduced to what fulfilment needs. */
export type PaymentEvent =
  | {
      id: string;
      type:
        | 'checkout.session.completed'
        | 'checkout.session.async_payment_succeeded'
        | 'checkout.session.async_payment_failed';
      sessionId: string;
      /** `payment_status` is paid (or no payment was required). */
      paid: boolean;
      taxCents: number;
    }
  | { id: string; type: 'other' };

/** Stripe Checkout and webhooks (PRD section 9). */
export interface PaymentGateway {
  /** False when Stripe is not configured (503 PAYMENTS_UNAVAILABLE). */
  isAvailable(): Promise<boolean>;
  createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession>;
  /** Verifies the signature on the raw body; throws CodedError INVALID_SIGNATURE. */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): Promise<PaymentEvent>;
}

/** Stripe settings from Platform settings (platform's SettingsReader satisfies it). */
export interface StripeSettings {
  stripe(): Promise<{
    secretKey: string | null;
    webhookSecret: string | null;
    taxEnabled: boolean;
  }>;
}

/** Platform ceilings.trialCredits (FR-11). */
export interface TrialCreditsSetting {
  trialCredits(): Promise<number>;
}

/**
 * The Audit log (FR-7), same shape as identity's. With `within` (billing's open transaction) the
 * entry is written in that transaction.
 */
export interface AuditRecorder {
  record(entry: AuditEntry, within?: ExternalTransaction): Promise<void>;
}

/** Whether a Business exists (identity answers; 404 on Staff grants). */
export interface BusinessDirectory {
  exists(businessId: string): Promise<boolean>;
}
