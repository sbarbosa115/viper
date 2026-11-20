import type { BusinessFact } from '../domain/customers.js';
import type { RunFact } from '../domain/metrics.js';

/**
 * Raw facts as the other contexts store them, in one place. The in-memory sources (fakes.ts)
 * compute their answers from it, and the MySQL fixture (mysql-world.ts) writes the same facts to
 * the real tables, so both runs must produce the same dashboard.
 */
export interface WorldBusiness extends BusinessFact {
  readonly lastActiveAt: Date | null;
}

export interface WorldLead {
  readonly id: string;
  readonly businessId: string;
  readonly runId: string;
  readonly deliveredAt: Date;
  readonly feedback: 'good' | 'not_fit' | null;
  readonly contacts: readonly { type: 'phone' | 'email'; verified: boolean }[];
}

export interface WorldLedgerEntry {
  readonly businessId: string;
  readonly type: 'grant' | 'purchase' | 'settlement' | 'adjustment';
  readonly credits: number;
  readonly at: Date;
}

export interface WorldPurchase {
  readonly businessId: string;
  readonly credits: number;
  readonly amountCents: number;
  readonly paidAt: Date;
}

export interface WorldReservation {
  readonly businessId: string;
  readonly runId: string;
  readonly credits: number;
  readonly status: 'open' | 'settled' | 'released';
}

export interface WorldToolCall {
  readonly toolKey: string;
  readonly at: Date;
  readonly providerCostMicros: number;
  readonly status: 'ok' | 'error' | 'skipped';
  readonly reused: boolean;
}

export interface World {
  businesses: WorldBusiness[];
  runs: RunFact[];
  leads: WorldLead[];
  ledger: WorldLedgerEntry[];
  purchases: WorldPurchase[];
  reservations: WorldReservation[];
  toolCalls: WorldToolCall[];
}

export function emptyWorld(): World {
  return {
    businesses: [],
    runs: [],
    leads: [],
    ledger: [],
    purchases: [],
    reservations: [],
    toolCalls: [],
  };
}
