import { ValidationError } from '../../../shared/domain/errors.js';
import { assertWholeCredits } from './wallet.js';

/**
 * Types a Ledger entry can have. The wallet ledger records the movements that change the balance
 * (grant, purchase, settlement, adjustment); holds live on Reservations, so `reservation` and
 * `release` stay reserved in the schema but are not written.
 */
export type LedgerEntryType =
  'grant' | 'purchase' | 'reservation' | 'release' | 'settlement' | 'adjustment';

export interface LedgerEntry {
  readonly id: string;
  readonly businessId: string;
  readonly type: LedgerEntryType;
  /** Signed: positive adds credits, negative removes them. */
  readonly credits: number;
  readonly description: string;
  readonly runId: string | null;
  readonly purchaseId: string | null;
  /** Unique when set, e.g. `trial:<businessId>`, `purchase:<sessionId>`. */
  readonly idempotencyKey: string | null;
  readonly createdByMemberId: string | null;
  readonly createdAt: Date;
}

export const TRIAL_DESCRIPTION = 'Free trial credits';
export const MAX_DESCRIPTION = 200;

export const trialKey = (businessId: string) => `trial:${businessId}`;
export const purchaseKey = (sessionId: string) => `purchase:${sessionId}`;
export const runDescription = (planName: string | undefined) =>
  planName ? `Run · ${planName}` : 'Research run';
export const packDescription = (packName: string) => `${packName} pack`;

type NewEntry = Omit<LedgerEntry, 'runId' | 'purchaseId' | 'idempotencyKey' | 'createdByMemberId'> &
  Partial<Pick<LedgerEntry, 'runId' | 'purchaseId' | 'idempotencyKey' | 'createdByMemberId'>>;

/** Builds an immutable Ledger entry, checking credits and description. */
export function ledgerEntry(props: NewEntry): LedgerEntry {
  assertWholeCredits(props.credits);
  const description = props.description.trim();
  if (description.length === 0 || description.length > MAX_DESCRIPTION) {
    throw new ValidationError('Description must be 1 to 200 characters', {
      description: 'Enter 1 to 200 characters',
    });
  }
  const positive = props.type === 'grant' || props.type === 'purchase';
  const negative = props.type === 'settlement';
  if ((positive && props.credits <= 0) || (negative && props.credits >= 0) || props.credits === 0) {
    throw new ValidationError(`A ${props.type} entry has the wrong sign`, {
      credits: String(props.credits),
    });
  }
  return {
    runId: null,
    purchaseId: null,
    idempotencyKey: null,
    createdByMemberId: null,
    ...props,
    description,
  };
}
