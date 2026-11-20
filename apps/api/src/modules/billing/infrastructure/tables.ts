import type { ColumnType, Generated } from 'kysely';
import type { Timestamp } from '../../../shared/infrastructure/db/schema.js';

export type LedgerEntryTypeColumn =
  'grant' | 'purchase' | 'reservation' | 'release' | 'settlement' | 'adjustment';

export interface CreditLedgerTable {
  id: string;
  business_id: string;
  type: LedgerEntryTypeColumn;
  /** Signed. */
  credits: number;
  description: string;
  run_id: string | null;
  purchase_id: string | null;
  /** e.g. `trial:<businessId>`, `purchase:<sessionId>`; unique when set. */
  idempotency_key: string | null;
  created_by_member_id: string | null;
  created_at: Timestamp;
}

export interface ReservationsTable {
  run_id: string;
  business_id: string;
  credits: number;
  status: 'open' | 'settled' | 'released';
  created_at: Timestamp;
  closed_at: Timestamp | null;
}

export interface CreditPacksTable {
  id: string;
  name: string;
  credits: number;
  price_cents: number;
  /** TINYINT(1) DEFAULT 1. */
  active: ColumnType<number, boolean | number | undefined, boolean | number>;
  position: Generated<number>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PurchasesTable {
  id: string;
  business_id: string;
  pack_id: string;
  /** The pack's credits at purchase time. */
  credits: number;
  stripe_session_id: string;
  stripe_event_id: string | null;
  amount_cents: number;
  tax_cents: Generated<number>;
  status: 'pending' | 'paid';
  created_at: Timestamp;
  paid_at: Timestamp | null;
}

/** One lock row per Business's Credit wallet (no balance: that stays derived from the ledger). */
export interface CreditWalletsTable {
  business_id: string;
  created_at: Timestamp;
}

export interface BillingTables {
  credit_wallets: CreditWalletsTable;
  credit_ledger: CreditLedgerTable;
  reservations: ReservationsTable;
  credit_packs: CreditPacksTable;
  purchases: PurchasesTable;
}
