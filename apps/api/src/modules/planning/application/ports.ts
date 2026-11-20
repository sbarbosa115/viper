import type { RunSummary } from '@app/contracts/research';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { PlanDraft } from '../domain/draft.js';
import type { GuardrailCeilings, GuardrailValues } from '../domain/guardrails.js';
import type { Plan, PlanSnapshot } from '../domain/plan.js';

// Planning's own storage --------------------------------------------------------------------------

export interface PlanPageCursor {
  readonly createdAt: Date;
  readonly id: string;
}

/** Plans of one Business. Every read is scoped by `businessId`; another Business's Plan is null. */
export interface PlanRepository {
  findById(businessId: string, planId: string): Promise<Plan | null>;
  save(plan: Plan): Promise<void>;
  /** Newest first (created_at, then id, descending), strictly after `after`. */
  list(
    businessId: string,
    page: { after?: PlanPageCursor; limit: number },
  ): Promise<PlanSnapshot[]>;
  /** True when any Target segment of the Business's Plans pitches the Product. */
  productInUse(businessId: string, productId: string): Promise<boolean>;
}

export type PlanningUnitOfWork = UnitOfWork<{ plans: PlanRepository }>;

// Other contexts, as planning needs them (wired in composition.ts) ---------------------------------

export interface ProfileProduct {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/** The Business Profile facts a Plan is drafted from. */
export interface ProfileView {
  readonly complete: boolean;
  readonly location: { readonly label: string; readonly lat: number; readonly lng: number } | null;
  readonly deliveryRadiusMiles: number | null;
  readonly products: readonly ProfileProduct[];
}

/** profile's public queries. Null when the Business has no profile yet. */
export interface ProfileReader {
  getProfile(businessId: string): Promise<ProfileView | null>;
}

/** research's Research flow settings (FR-37): plan defaults and the limits a Plan may use. */
export interface FlowDefaults {
  planDefaults(flowKey: string): Promise<GuardrailValues>;
  /** The flow's run limits within the Platform ceilings (max credits, max leads). */
  ceilings(flowKey: string): Promise<GuardrailCeilings>;
}

/** research's run history, for the estimate (FR-17). */
export interface RunStats {
  /**
   * Median credits spent by the last 20 completed runs of the flow that delivered ≥ 1 Lead, or
   * null when fewer than 5 such runs exist.
   */
  typicalCredits(flowKey: string): Promise<number | null>;
}

/** billing's Credit wallet: the available balance (balance − reserved). */
export interface WalletReader {
  available(businessId: string): Promise<number>;
}

/** What other contexts know about Plans (research: last run; leads: Lead counts), batched. */
export interface PlanActivity {
  lastRuns(
    businessId: string,
    planIds: readonly string[],
  ): Promise<ReadonlyMap<string, RunSummary>>;
  leadsCounts(businessId: string, planIds: readonly string[]): Promise<ReadonlyMap<string, number>>;
}

// The planning model -----------------------------------------------------------------------------

/**
 * Drafts a Plan for a Goal from the Business Profile (planning model). Throws the shared
 * LlmUnavailableError when the model is down, times out or returns nothing usable.
 */
export interface PlanDrafter {
  draft(input: { goal: string; profile: ProfileView }): Promise<PlanDraft>;
}
