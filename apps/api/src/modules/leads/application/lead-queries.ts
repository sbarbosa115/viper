import {
  leadCsvColumns,
  type Lead,
  type LeadListStats,
  type LeadSummary,
} from '@app/contracts/leads';
import type { AnalyticsTracker } from '../../../shared/application/analytics-tracker.js';
import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import { csvFileName, csvSafe } from '../domain/csv.js';
import { cursorAfter, type LeadCursor, type LeadRecord } from '../domain/lead.js';
import type {
  LeadFilterValues,
  LeadQuality,
  LeadsUnitOfWork,
  LeadTotals,
  PlanLookup,
  RunCosts,
} from './ports.js';
import {
  assertCanUseLeads,
  decodeLeadCursor,
  encodeLeadCursor,
  leadNotFound,
  leadOf,
  leadSummaryOf,
  planNotFound,
} from './views.js';

export interface LeadQueriesDeps {
  uow: LeadsUnitOfWork;
  clock: Clock;
  analytics: AnalyticsTracker;
  plans: PlanLookup;
  runCosts: RunCosts;
}

export type LeadListQuery = LeadFilterValues & {
  readonly cursor?: string | undefined;
  readonly limit: number;
};

/** Rows read per batch while streaming the CSV. */
const EXPORT_BATCH = 200;

const round = (value: number, places: number) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

export function statsOf(totals: LeadTotals, creditsSpent: number): LeadListStats {
  const { total } = totals;
  return {
    total,
    avgFitScore: total > 0 ? round(totals.fitScoreSum / total, 1) : null,
    verifiedPct:
      totals.phoneEmailContacts > 0
        ? round((totals.verifiedPhoneEmail / totals.phoneEmailContacts) * 100, 1)
        : null,
    creditsSpent,
    costPerLead: total > 0 ? round(creditsSpent / total, 2) : null,
  };
}

/** The first value of a Contact type, preferring a Verified one. */
function firstContact(lead: LeadRecord, type: LeadRecord['contacts'][number]['type']) {
  const all = lead.contacts.filter((c) => c.type === type);
  return all.find((c) => c.verification === 'verified') ?? all[0] ?? null;
}

/** One CSV row in `leadCsvColumns` order (FR-28), with the CSV-injection guard applied. */
export function csvRowOf(lead: LeadRecord): string[] {
  const phone = firstContact(lead, 'phone');
  const email = firstContact(lead, 'email');
  const verified = (c: { verification: string } | null) =>
    c ? (c.verification === 'verified' ? 'yes' : 'no') : '';
  const urls = [
    ...lead.contacts.map((c) => c.source.url),
    ...lead.evidence.map((e) => e.source.url),
  ].filter((u): u is string => !!u);
  const values: Record<(typeof leadCsvColumns)[number], string> = {
    business_name: lead.name,
    category: lead.category ?? '',
    address: lead.address ?? '',
    distance_miles: lead.distanceMiles === null ? '' : lead.distanceMiles.toFixed(2),
    phone: phone?.value ?? '',
    phone_verified: verified(phone),
    email: email?.value ?? '',
    email_verified: verified(email),
    website: firstContact(lead, 'website')?.value ?? '',
    instagram: firstContact(lead, 'instagram')?.value ?? '',
    tiktok: firstContact(lead, 'tiktok')?.value ?? '',
    yelp: firstContact(lead, 'yelp')?.value ?? '',
    fit_score: String(lead.fitScore),
    pitch_product: lead.pitch.productName,
    pitch_reason: lead.pitch.reason,
    feedback: lead.feedback ?? '',
    sources: [...new Set(urls)].join(';'),
    delivered_at: lead.deliveredAt.toISOString(),
  };
  return leadCsvColumns.map((column) => csvSafe(values[column]));
}

/** Reads of Leads: the Lead list with stats (FR-26), a Lead, the CSV (FR-28), counts for others. */
export class LeadQueries {
  constructor(private readonly deps: LeadQueriesDeps) {}

  /** GET /api/plans/:id/leads. Stats cover the Plan's Leads, or one run's when `runId` is set. */
  async listLeads(
    actor: Actor,
    planId: string,
    query: LeadListQuery,
  ): Promise<{ items: LeadSummary[]; nextCursor: string | null; stats: LeadListStats }> {
    assertCanUseLeads(actor);
    const { businessId } = actor;
    const plan = await this.deps.plans.findPlan(businessId, planId);
    if (!plan) throw planNotFound(planId);
    const after = query.cursor ? decodeLeadCursor(query.cursor, query.sort) : undefined;
    const scope = { businessId, planId };
    const [rows, totals, creditsSpent] = await Promise.all([
      this.deps.uow.run(({ leads }) => leads.list(scope, query, { after, limit: query.limit + 1 })),
      this.deps.uow.run(({ leads }) => leads.totals({ ...scope, runId: query.runId })),
      this.deps.runCosts.creditsSpentForPlan(businessId, planId, query.runId),
    ]);
    const pageRows = rows.slice(0, query.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(leadSummaryOf),
      nextCursor:
        rows.length > query.limit && last ? encodeLeadCursor(cursorAfter(query.sort, last)) : null,
      stats: statsOf(totals, creditsSpent),
    };
  }

  /** GET /api/leads/:id. */
  async getLead(actor: Actor, leadId: string): Promise<Lead> {
    assertCanUseLeads(actor);
    const [lead] = await this.deps.uow.run(({ leads }) =>
      leads.findMany(actor.businessId, [leadId]),
    );
    if (!lead) throw leadNotFound(leadId);
    return leadOf(lead);
  }

  /**
   * GET /api/plans/:id/leads.csv (FR-28): checks the Plan first (404 before any byte is sent),
   * then streams the header and one row per Lead in the filter's order. Fires `leads_exported`
   * once the last row is read.
   */
  async exportLeads(
    actor: Actor,
    planId: string,
    filters: LeadFilterValues,
  ): Promise<{ fileName: string; rows: AsyncGenerator<string[]> }> {
    assertCanUseLeads(actor);
    const plan = await this.deps.plans.findPlan(actor.businessId, planId);
    if (!plan) throw planNotFound(planId);
    const { uow, analytics } = this.deps;
    const scope = { businessId: actor.businessId, planId };
    async function* rows(): AsyncGenerator<string[]> {
      yield [...leadCsvColumns];
      let after: LeadCursor | undefined;
      let count = 0;
      for (;;) {
        const page = await uow.run(({ leads }) =>
          leads.list(scope, filters, { after, limit: EXPORT_BATCH }),
        );
        if (page.length === 0) break;
        const details = await uow.run(({ leads }) =>
          leads.findMany(
            scope.businessId,
            page.map((r) => r.id),
          ),
        );
        const byId = new Map(details.map((d) => [d.id, d]));
        for (const row of page) {
          const lead = byId.get(row.id);
          if (!lead) continue;
          count += 1;
          yield csvRowOf(lead);
        }
        const last = page.at(-1);
        if (!last || page.length < EXPORT_BATCH) break;
        after = cursorAfter(filters.sort, last);
      }
      await analytics.track({
        name: 'leads_exported',
        actor,
        properties: { plan_id: planId, leads_count: count },
      });
    }
    return { fileName: csvFileName(plan.name, this.deps.clock.now()), rows: rows() };
  }

  /** planning's PlanActivity: Lead counts per Plan (Plans without Leads are left out). */
  leadsCounts(
    businessId: string,
    planIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    if (planIds.length === 0) return Promise.resolve(new Map());
    return this.deps.uow.run(({ leads }) => leads.countsByPlan(businessId, planIds));
  }

  /** reporting's customer list: Leads delivered per Business. */
  deliveredCounts(businessIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
    if (businessIds.length === 0) return Promise.resolve(new Map());
    return this.deps.uow.run(({ leads }) => leads.countsByBusiness(businessIds));
  }

  /**
   * reporting's Leads tile (FR-30): delivered, Good lead % (of Leads with Feedback) and
   * verified-contact % (phone and email Contacts) for Leads delivered in [from, to).
   */
  async leadQuality(window: {
    from: Date;
    to: Date;
  }): Promise<LeadQuality & { goodPct: number | null; verifiedPct: number | null }> {
    const q = await this.deps.uow.run(({ leads }) => leads.quality(window));
    return {
      ...q,
      goodPct: q.withFeedback > 0 ? round((q.good / q.withFeedback) * 100, 1) : null,
      verifiedPct:
        q.phoneEmailContacts > 0
          ? round((q.verifiedPhoneEmail / q.phoneEmailContacts) * 100, 1)
          : null,
    };
  }
}
