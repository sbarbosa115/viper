import { providerKeyOf } from '@app/contracts/finance';
import type { AnalyticsEvent } from '../../../shared/application/analytics-tracker.js';
import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import { CodedError, ForbiddenError } from '../../../shared/domain/errors.js';
import {
  dayOfInstant,
  HISTORY_START_MONTH,
  monthOfInstant,
  type CalendarDay,
  type MonthKey,
} from '../domain/calendar.js';
import { providerCategoryOf, type ProviderCategory } from '../domain/categories.js';
import type { ToolsMetering } from './ports.js';

/** FR-13, NFR-2: every finance endpoint is for Staff who passed two-factor (Acting as ignored). */
export function requireStaff(actor: Actor | null | undefined): Actor {
  if (!actor?.roles.includes('staff')) throw new ForbiddenError('Staff only');
  return actor;
}

/**
 * The analytics actor of a finance event: the Staff Member and no Business, since finance is
 * platform-wide and ignores Acting as (FR-13). The platform tracker stores `business_id` NULL.
 */
export const staffAnalyticsActor = (actor: Actor): AnalyticsEvent['actor'] => ({
  memberId: actor.memberId,
  businessId: null,
});

export const todayOf = (clock: Clock): CalendarDay => dayOfInstant(clock.now());
export const currentMonthOf = (clock: Clock): MonthKey => monthOfInstant(clock.now());

/**
 * Section 7 month rules: from the history start (2026-11) to the current month. Before → 422
 * BEFORE_HISTORY_START, after → 422 FUTURE_MONTH. Omitted → the current month.
 */
export function resolveMonth(month: MonthKey | undefined, clock: Clock): MonthKey {
  const current = currentMonthOf(clock);
  const m = month ?? current;
  if (m < HISTORY_START_MONTH) {
    throw new CodedError(
      'BEFORE_HISTORY_START',
      'There is no data before November 2026',
      { month: m },
      422,
    );
  }
  if (m > current) {
    throw new CodedError('FUTURE_MONTH', "That month hasn't started yet", { month: m }, 422);
  }
  return m;
}

export interface CatalogProvider {
  key: string;
  name: string;
  category: ProviderCategory;
}

/** FR-6: the Tool catalog's providers with their keys and categories, sorted by name. */
export async function catalogProviders(tools: ToolsMetering): Promise<CatalogProvider[]> {
  const providers = await tools.providers();
  return providers
    .map((p) => ({
      key: providerKeyOf(p.name),
      name: p.name,
      category: providerCategoryOf(p.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A provider key → the catalog provider; 404 UNKNOWN_PROVIDER otherwise. */
export async function providerByKey(tools: ToolsMetering, key: string): Promise<CatalogProvider> {
  const found = (await catalogProviders(tools)).find((p) => p.key === key);
  if (!found) throw new CodedError('UNKNOWN_PROVIDER', 'Unknown provider', { provider: key }, 404);
  return found;
}
