import { LOCAL_BUYERS_FLOW_KEY } from '@app/contracts/research';
import type { AnalyticsTracker } from '../../../shared/application/analytics-tracker.js';
import type { Geocoder } from '../../../shared/application/geocoder.js';
import { LlmUnavailableError } from '../../../shared/application/llm-client.js';
import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import { CodedError } from '../../../shared/domain/errors.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import { draftRadius, normaliseDraft, type PlanDraft } from '../domain/draft.js';
import { Guardrails } from '../domain/guardrails.js';
import { Plan, type PlanSnapshot } from '../domain/plan.js';
import { SearchArea } from '../domain/search-area.js';
import {
  assertCanPlan,
  assertVerified,
  DAILY_PLAN_LIMIT,
  dailyPlanLimitReached,
  profileIncomplete,
  startOfUtcDay,
  usableProfile,
} from './policies.js';
import type {
  FlowDefaults,
  PlanDrafter,
  PlanningUnitOfWork,
  ProfileReader,
  ProfileView,
  WalletReader,
} from './ports.js';

export interface CreatePlanDeps {
  uow: PlanningUnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  analytics: AnalyticsTracker;
  drafter: PlanDrafter;
  geocoder: Geocoder;
  profiles: ProfileReader;
  flows: FlowDefaults;
  wallet: WalletReader;
  /** Plans per Business per UTC day; DAILY_PLAN_LIMIT (30) when absent. */
  dailyPlanLimit?: number;
}

export interface CreatedPlan {
  plan: PlanSnapshot;
  warnings: string[];
}

export function assistantUnavailable(): CodedError {
  return new CodedError(
    'ASSISTANT_UNAVAILABLE',
    "We couldn't draft your plan just now. Try again in a moment.",
  );
}

/**
 * FR-16: Create a Plan from a Goal. Needs a verified email (403 EMAIL_NOT_VERIFIED) and at most 30
 * Plans per Business per UTC day (429 TOO_MANY_REQUESTS), since each one calls the planning model. The planning model drafts the name, Target segments and any
 * place or radius in the goal; the rules here pick the Search area (profile location unless the
 * goal names a place that geocodes; radius from the goal, else the delivery radius, 1–25 miles)
 * and the Guardrails (the flow's plan defaults, max credits capped by the available balance).
 */
export class CreatePlan {
  constructor(private readonly deps: CreatePlanDeps) {}

  async execute(actor: Actor, goal: string): Promise<CreatedPlan> {
    assertCanPlan(actor);
    assertVerified(actor);
    const { deps } = this;
    const limit = deps.dailyPlanLimit ?? DAILY_PLAN_LIMIT;
    const today = await deps.uow.run(({ plans }) =>
      plans.countCreatedSince(actor.businessId, startOfUtcDay(deps.clock.now())),
    );
    if (today >= limit) throw dailyPlanLimitReached(limit);
    const profile = usableProfile(await deps.profiles.getProfile(actor.businessId));
    if (!profile) throw profileIncomplete();

    const draft = await this.draft(goal, profile);
    const segments = normaliseDraft(draft, {
      goal,
      productIds: profile.products.map((p) => p.id),
      newId: () => deps.ids.next(),
    });
    if (!segments) throw assistantUnavailable();

    const warnings: string[] = [];
    let centre = profile.location;
    if (draft.place) {
      const found = await this.locate(draft.place);
      if (found) centre = found;
      else warnings.push(`We couldn't find '${draft.place}', so we used your address.`);
    }

    const flowKey = LOCAL_BUYERS_FLOW_KEY;
    const [defaults, ceilings, available] = await Promise.all([
      deps.flows.planDefaults(flowKey),
      deps.flows.ceilings(flowKey),
      deps.wallet.available(actor.businessId),
    ]);

    const plan = Plan.create({
      id: deps.ids.next(),
      businessId: actor.businessId,
      flowKey,
      name: segments.name,
      goal,
      segments: segments.segments,
      searchArea: SearchArea.of({
        label: centre.label,
        lat: centre.lat,
        lng: centre.lng,
        radiusMiles: draftRadius(draft.radiusMiles, goal, profile.deliveryRadiusMiles),
      }),
      guardrails: Guardrails.defaults(defaults, ceilings, available),
      productIds: new Set(profile.products.map((p) => p.id)),
      now: deps.clock.now(),
    });
    await deps.uow.run(({ plans }) => plans.save(plan));

    await deps.analytics.track({
      name: 'plan_created',
      actor,
      properties: {
        business_id: actor.businessId,
        plan_id: plan.id,
        segments_count: plan.segments.length,
        radius_miles: plan.searchArea.radiusMiles,
      },
    });
    return { plan: plan.toSnapshot(), warnings };
  }

  private async draft(goal: string, profile: ProfileView): Promise<PlanDraft> {
    try {
      return await this.deps.drafter.draft({ goal, profile });
    } catch (error) {
      if (error instanceof LlmUnavailableError) throw assistantUnavailable();
      throw error;
    }
  }

  /** The first geocoded match for a place the goal names, or null. */
  private async locate(place: string): Promise<{ label: string; lat: number; lng: number } | null> {
    const [hit] = await this.deps.geocoder.search(place, 1);
    return hit ? { label: hit.label, lat: hit.lat, lng: hit.lng } : null;
  }
}
