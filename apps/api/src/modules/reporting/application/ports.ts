import type { Clock } from '../../../shared/domain/clock.js';
import type { BusinessFact } from '../domain/customers.js';
import type { RunFact, ToolSpend } from '../domain/metrics.js';
import type { TimeWindow } from '../domain/period.js';

/**
 * Reporting reads other contexts only through their public queries (context map). Each port is
 * what one module provides; composition.ts adapts the modules' query objects to them.
 */

// identity ----------------------------------------------------------------------------------------

export interface CustomerListRow {
  id: string;
  name: string;
  internal: boolean;
  ownerEmail: string;
  verified: boolean;
  signedUpAt: Date;
  lastActiveAt: Date | null;
}

export interface CustomerListQuery {
  /** Business name or Owner email. */
  q?: string;
  sort: 'signedUp' | 'lastActive';
  cursor?: string;
  limit: number;
}

export interface ReportingIdentity {
  /** identity.allBusinesses: every Business with its Owner (fewer than a few hundred). */
  allBusinesses(): Promise<BusinessFact[]>;
  /** identity.listBusinesses: FR-31 search, sort and cursor pagination. */
  listBusinesses(
    query: CustomerListQuery,
  ): Promise<{ items: CustomerListRow[]; nextCursor: string | null }>;
  /** identity.getBusiness. */
  getBusiness(id: string): Promise<{
    id: string;
    name: string;
    internal: boolean;
    createdAt: Date;
    lastActiveAt: Date | null;
  } | null>;
  /** identity.getOwnerContact. */
  getOwnerContact(businessId: string): Promise<{ email: string; emailVerified: boolean } | null>;
  /**
   * identity.setBusinessInternal: NotFoundError when unknown. `by` is written to the Audit log in
   * the same transaction as the change (FR-7).
   */
  setBusinessInternal(
    businessId: string,
    internal: boolean,
    by: { staffMemberId: string; action: string; details: Record<string, unknown> },
  ): Promise<void>;
}

// billing -----------------------------------------------------------------------------------------

export interface CreditsSummary {
  packRevenueCents: number;
  creditsGranted: number;
  creditsPurchased: number;
  creditsSpent: number;
  unspentCredits: number;
}

export interface ReportingBilling {
  /** billing.creditsSummary: ledger and purchases in the window, minus excluded Businesses. */
  creditsSummary(filter: {
    from: Date;
    to: Date;
    excludeBusinessIds: readonly string[];
  }): Promise<CreditsSummary>;
  /** billing.availableByBusiness. */
  availableByBusiness(businessIds: readonly string[]): Promise<ReadonlyMap<string, number>>;
  /**
   * billing.payingBusinessIds: Businesses with a paid purchase. `paidBefore` limits it to
   * purchases paid before that time (the previous period's "paying").
   */
  payingBusinessIds(
    businessIds: readonly string[],
    options?: { paidBefore?: Date },
  ): Promise<ReadonlySet<string>>;
}

// research ----------------------------------------------------------------------------------------

export interface ReportingResearch {
  /** research.reportingQueries.runFacts: every run queued in [from, to), all Businesses. */
  runFacts(window: TimeWindow): Promise<RunFact[]>;
  /** research.reportingQueries.runCounts: runs ever started per Business (customer list). */
  runCounts(businessIds: readonly string[]): Promise<ReadonlyMap<string, number>>;
}

// leads -------------------------------------------------------------------------------------------

export interface LeadQualityFacts {
  delivered: number;
  good: number;
  goodPct: number | null;
  verifiedPct: number | null;
}

export interface ReportingLeads {
  /** leads.leadQuality: Leads delivered in [from, to), all Businesses. */
  leadQuality(window: TimeWindow): Promise<LeadQualityFacts>;
  /** leads.deliveredCounts. */
  deliveredCounts(businessIds: readonly string[]): Promise<ReadonlyMap<string, number>>;
}

// tools -------------------------------------------------------------------------------------------

export interface ReportingTools {
  /** tools.toolQueries.spendByTool: provider cost, calls and errors per Tool in [from, to). */
  spendByTool(window: TimeWindow): Promise<ToolSpend[]>;
}

// platform ----------------------------------------------------------------------------------------

/** platform's Audit log (FR-7: every back-office write). */
export interface ReportingAudit {
  record(entry: {
    staffMemberId: string;
    businessId: string | null;
    action: string;
    targetType: string;
    targetId: string | null;
    details?: Record<string, unknown>;
  }): Promise<void>;
}

export interface ReportingSources {
  identity: ReportingIdentity;
  billing: ReportingBilling;
  research: ReportingResearch;
  leads: ReportingLeads;
  tools: ReportingTools;
}

export interface ReportingDeps extends ReportingSources {
  audit: ReportingAudit;
  clock: Clock;
}
