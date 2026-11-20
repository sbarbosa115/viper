import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type {
  Feedback,
  FeedbackValue,
  LeadContact,
  LeadCursor,
  LeadListRow,
  LeadRecord,
  LeadSort,
} from '../domain/lead.js';
import type { EvidenceItem, Pitch, Prospect, SourceRef } from '../domain/prospect.js';

// leads' own storage ------------------------------------------------------------------------------

export interface ProspectRepository {
  /** The run's Prospects in the order they were found. */
  listByRun(runId: string): Promise<Prospect[]>;
  findById(prospectId: string): Promise<Prospect | null>;
  /** Insert or replace. */
  save(prospect: Prospect): Promise<void>;
}

/** A Source row written with a delivery; Contacts and Evidence point at it by id. */
export interface NewSource extends SourceRef {
  readonly id: string;
}

/** A Lead as Step 10 creates it (FR-25). */
export interface NewLead {
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
  readonly deliveredAt: Date;
  readonly contacts: readonly (Omit<LeadContact, 'source'> & { id: string; sourceId: string })[];
  readonly evidence: readonly (Omit<EvidenceItem, 'source'> & { id: string; sourceId: string })[];
}

/** List and export filters (FR-26, FR-28), already validated. */
export interface LeadFilterValues {
  readonly runId?: string | undefined;
  readonly minScore?: number | undefined;
  readonly feedback?: FeedbackValue | 'none' | undefined;
  readonly q?: string | undefined;
  readonly sort: LeadSort;
}

/** Raw numbers for the stats strip (FR-26). */
export interface LeadTotals {
  readonly total: number;
  readonly fitScoreSum: number;
  /** Phone and email Contacts of these Leads, and how many of them are Verified. */
  readonly phoneEmailContacts: number;
  readonly verifiedPhoneEmail: number;
}

/** Lead quality over a time window, for the Staff dashboard (FR-30). */
export interface LeadQuality {
  readonly delivered: number;
  readonly withFeedback: number;
  readonly good: number;
  readonly phoneEmailContacts: number;
  readonly verifiedPhoneEmail: number;
}

export interface LeadRepository {
  /** Every place key of the Prospects already delivered as Leads of this Plan. */
  deliveredPlaceKeys(planId: string): Promise<Set<string>>;
  countByRun(runId: string): Promise<number>;
  /** Writes the Sources, Leads, Contacts and Evidence. */
  insert(sources: readonly NewSource[], leads: readonly NewLead[]): Promise<void>;
  /** The Business's Leads with these ids (others are left out), not removed. */
  findMany(businessId: string, leadIds: readonly string[]): Promise<LeadRecord[]>;
  saveFeedback(leadId: string, feedback: Feedback | null, at: Date): Promise<void>;
  /** One page of a Plan's Leads in the filter's order, strictly after `after`. */
  list(
    scope: { businessId: string; planId: string },
    filters: LeadFilterValues,
    page: { after?: LeadCursor | undefined; limit: number },
  ): Promise<LeadListRow[]>;
  totals(scope: {
    businessId: string;
    planId: string;
    runId?: string | undefined;
  }): Promise<LeadTotals>;
  countsByPlan(businessId: string, planIds: readonly string[]): Promise<Map<string, number>>;
  countsByBusiness(businessIds: readonly string[]): Promise<Map<string, number>>;
  /** Leads delivered in [from, to), with their Feedback and phone/email verification. */
  quality(window: { from: Date; to: Date }): Promise<LeadQuality>;
}

export type LeadsUnitOfWork = UnitOfWork<{
  prospects: ProspectRepository;
  leads: LeadRepository;
}>;

// Other contexts, as leads needs them (wired in composition.ts) -----------------------------------

/** planning: the Plan a Lead list belongs to; null when it isn't the Business's. */
export interface PlanLookup {
  findPlan(
    businessId: string,
    planId: string,
  ): Promise<{ id: string; name: string; centre: { lat: number; lng: number } } | null>;
}

/** research: credits spent by a Plan's runs (or one run), for the stats strip (FR-26). */
export interface RunCosts {
  creditsSpentForPlan(businessId: string, planId: string, runId?: string): Promise<number>;
}
