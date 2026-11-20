import { ValidationError } from '../../../shared/domain/errors.js';
import type { ContactType, EvidenceItem, Pitch, SourceRef } from './prospect.js';

export type FeedbackValue = 'good' | 'not_fit';

export interface LeadContact {
  readonly type: ContactType;
  readonly value: string;
  readonly label: string | null;
  /** Invalid Contacts are dropped at delivery, so a Lead's are verified or "Not verified". */
  readonly verification: 'verified' | 'unverified';
  readonly source: SourceRef;
}

/** A delivered Lead with its Contacts and Evidence (ordered by position). */
export interface LeadRecord {
  readonly id: string;
  readonly businessId: string;
  readonly planId: string;
  readonly runId: string;
  readonly prospectId: string;
  readonly placeKey: string;
  readonly name: string;
  readonly category: string | null;
  readonly address: string | null;
  readonly distanceMiles: number | null;
  readonly fitScore: number;
  readonly pitch: Pitch;
  readonly feedback: FeedbackValue | null;
  readonly feedbackReason: string | null;
  readonly feedbackAt: Date | null;
  readonly deliveredAt: Date;
  readonly contacts: readonly LeadContact[];
  readonly evidence: readonly EvidenceItem[];
}

/** What a list row needs: the Lead's columns and which kinds of Contact it has. */
export interface LeadListRow {
  readonly id: string;
  readonly runId: string;
  readonly name: string;
  readonly category: string | null;
  readonly distanceMiles: number | null;
  readonly fitScore: number;
  readonly feedback: FeedbackValue | null;
  readonly deliveredAt: Date;
  readonly contactTypes: readonly ContactType[];
}

export const MAX_FEEDBACK_REASON = 200;

/**
 * A Member's Feedback on a Lead (FR-27): "Good lead", or "Not a fit" with an optional reason
 * (a chip or other text ≤ 200). `null` clears it.
 */
export interface Feedback {
  readonly value: FeedbackValue;
  readonly reason: string | null;
}

export function feedbackOf(value: FeedbackValue | null, reason?: string | null): Feedback | null {
  if (value === null) return null;
  const text = reason?.trim() ?? '';
  if (text.length > MAX_FEEDBACK_REASON) {
    throw new ValidationError('The reason is too long', { reason: 'At most 200 characters' });
  }
  return { value, reason: value === 'not_fit' && text ? text : null };
}

// Lead list order and cursors (FR-26) -------------------------------------------------------------

export type LeadSort = 'score' | 'distance' | 'newest';

/** Where a page ended: the sort key of the last row and its id. */
export interface LeadCursor {
  readonly sort: LeadSort;
  readonly key: number | string | null;
  readonly id: string;
}

type Orderable = Pick<LeadListRow, 'id' | 'fitScore' | 'distanceMiles' | 'deliveredAt'>;

/**
 * - score: Fit score high to low, then id.
 * - distance: nearest first, unknown distance last, then id.
 * - newest: latest delivery first, then id.
 */
export function compareLeads(sort: LeadSort, a: Orderable, b: Orderable): number {
  const byId = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (sort === 'score') return b.fitScore - a.fitScore || byId;
  if (sort === 'newest') return b.deliveredAt.getTime() - a.deliveredAt.getTime() || byId;
  const da = a.distanceMiles;
  const db = b.distanceMiles;
  if (da === null && db === null) return byId;
  if (da === null) return 1;
  if (db === null) return -1;
  return da - db || byId;
}

export function cursorAfter(sort: LeadSort, row: Orderable): LeadCursor {
  const key =
    sort === 'score'
      ? row.fitScore
      : sort === 'distance'
        ? row.distanceMiles
        : row.deliveredAt.toISOString();
  return { sort, key, id: row.id };
}

/** True when `row` comes after the cursor in the cursor's order. */
export function isAfterCursor(row: Orderable, cursor: LeadCursor): boolean {
  const at: Orderable = {
    id: cursor.id,
    fitScore: typeof cursor.key === 'number' ? cursor.key : 0,
    distanceMiles: typeof cursor.key === 'number' ? cursor.key : null,
    deliveredAt: new Date(typeof cursor.key === 'string' ? cursor.key : 0),
  };
  return compareLeads(cursor.sort, row, at) > 0;
}
