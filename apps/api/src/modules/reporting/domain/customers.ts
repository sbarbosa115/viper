import { percent } from './metrics.js';
import { DAY_MS, daysIn, isoDay, within, type TimeWindow } from './period.js';

/** A Business with its Owner, as identity reports it. */
export interface BusinessFact {
  readonly id: string;
  readonly name: string;
  readonly ownerEmail: string;
  readonly internal: boolean;
  /** The Owner is Staff: the Staff's own Business. */
  readonly ownerIsStaff: boolean;
  readonly signedUpAt: Date;
  readonly verifiedAt: Date | null;
}

/**
 * FR-30: Staff's own Business and Businesses marked internal are not customers. They are left out
 * of the customer and revenue tiles (and the tables), but their runs and Leads still count.
 */
export function isCustomer(b: BusinessFact): boolean {
  return !b.internal && !b.ownerIsStaff;
}

/** Trial-to-paid looks only at Businesses older than this (they had time to buy). */
export const TRIAL_TO_PAID_MIN_AGE_DAYS = 14;

export interface CustomerCounts {
  /** Signed up before the end of the window. */
  total: number;
  /** Signed up in the window. */
  newSignups: number;
  /** Owner email verified before the end of the window. */
  verified: number;
  /** At least one run in the window. */
  active: number;
  /** At least one paid purchase before the end of the window. */
  paying: number;
  /** paying ÷ verified, of Businesses at least 14 days old at the end of the window. */
  trialToPaidPct: number | null;
}

export function customerCounts(
  customers: readonly BusinessFact[],
  window: TimeWindow,
  facts: { activeIds: ReadonlySet<string>; payingIds: ReadonlySet<string> },
): CustomerCounts {
  const existing = customers.filter((c) => c.signedUpAt < window.to);
  const verified = (c: BusinessFact) => c.verifiedAt !== null && c.verifiedAt < window.to;
  const oldEnough = new Date(window.to.getTime() - TRIAL_TO_PAID_MIN_AGE_DAYS * DAY_MS);
  const eligible = existing.filter((c) => c.signedUpAt <= oldEnough && verified(c));
  return {
    total: existing.length,
    newSignups: existing.filter((c) => within(c.signedUpAt, window)).length,
    verified: existing.filter(verified).length,
    active: existing.filter((c) => facts.activeIds.has(c.id)).length,
    paying: existing.filter((c) => facts.payingIds.has(c.id)).length,
    trialToPaidPct: percent(
      eligible.filter((c) => facts.payingIds.has(c.id)).length,
      eligible.length,
    ),
  };
}

/** New sign-ups per UTC day of the window, zero days included. */
export function signupsByDay(
  customers: readonly BusinessFact[],
  window: TimeWindow,
): { date: string; count: number }[] {
  const counts = new Map(daysIn(window).map((d) => [d, 0]));
  for (const c of customers) {
    if (!within(c.signedUpAt, window)) continue;
    const day = isoDay(c.signedUpAt);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts].map(([date, count]) => ({ date, count }));
}

/** The newest sign-ups, newest first; ties by id. */
export function latestSignups(customers: readonly BusinessFact[], limit: number): BusinessFact[] {
  return [...customers]
    .sort((a, b) => b.signedUpAt.getTime() - a.signedUpAt.getTime() || b.id.localeCompare(a.id))
    .slice(0, limit);
}
