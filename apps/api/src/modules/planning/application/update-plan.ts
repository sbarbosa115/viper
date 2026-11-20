import type { UpdatePlanBody } from '@app/contracts/planning';
import type { AnalyticsTracker } from '../../../shared/application/analytics-tracker.js';
import type { Geocoder } from '../../../shared/application/geocoder.js';
import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import { CodedError, NotFoundError } from '../../../shared/domain/errors.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import { Guardrails } from '../domain/guardrails.js';
import type { IcpField, Plan, PlanSnapshot } from '../domain/plan.js';
import { assertCanPlan } from './policies.js';
import type { FlowDefaults, PlanningUnitOfWork, ProfileReader } from './ports.js';

export interface UpdatePlanDeps {
  uow: PlanningUnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  analytics: AnalyticsTracker;
  geocoder: Geocoder;
  profiles: ProfileReader;
  flows: FlowDefaults;
}

type SearchAreaEdit = NonNullable<UpdatePlanBody['searchArea']>;

export function planNotFound(planId: string): NotFoundError {
  return new NotFoundError('Plan not found', { planId });
}

/**
 * FR-17: Edit a Plan (name, Target segments, Search area, Guardrails), any time; runs use a
 * snapshot. A place query is geocoded (none found → 422 ADDRESS_NOT_FOUND). Guardrails are checked
 * against the flow's limits. The Plan's first ICP edit fires `plan_icp_edited`.
 */
export class UpdatePlan {
  constructor(private readonly deps: UpdatePlanDeps) {}

  async execute(actor: Actor, planId: string, body: UpdatePlanBody): Promise<PlanSnapshot> {
    assertCanPlan(actor);
    const { deps } = this;
    const place = body.searchArea?.query ? await this.geocode(body.searchArea.query) : null;
    const productIds = body.segments ? await this.productIds(actor.businessId) : new Set<string>();

    const { plan, icpField } = await deps.uow.run(async ({ plans }) => {
      const found = await plans.findById(actor.businessId, planId);
      if (!found) throw planNotFound(planId);
      const now = deps.clock.now();
      if (body.name !== undefined) found.rename(body.name, now);
      let field: IcpField | null = null;
      if (body.segments) {
        field = found.replaceSegments(body.segments, {
          productIds,
          newId: () => deps.ids.next(),
          now,
        });
      }
      if (body.searchArea) applySearchArea(found, body.searchArea, place, now);
      if (body.guardrails) {
        const ceilings = await deps.flows.ceilings(found.flowKey);
        found.changeGuardrails(Guardrails.of(body.guardrails, ceilings), now);
      }
      await plans.save(found);
      return { plan: found.toSnapshot(), icpField: field };
    });

    if (icpField) {
      await deps.analytics.track({
        name: 'plan_icp_edited',
        actor,
        properties: { business_id: actor.businessId, plan_id: plan.id, field: icpField },
      });
    }
    return plan;
  }

  private async geocode(query: string): Promise<{ label: string; lat: number; lng: number }> {
    const [hit] = await this.deps.geocoder.search(query, 1);
    if (!hit) {
      throw new CodedError('ADDRESS_NOT_FOUND', `We couldn't find '${query}'`, {
        fields: { 'searchArea.query': 'Place not found' },
      });
    }
    return { label: hit.label, lat: hit.lat, lng: hit.lng };
  }

  private async productIds(businessId: string): Promise<Set<string>> {
    const profile = await this.deps.profiles.getProfile(businessId);
    return new Set((profile?.products ?? []).map((p) => p.id));
  }
}

function applySearchArea(
  plan: Plan,
  edit: SearchAreaEdit,
  geocoded: { label: string; lat: number; lng: number } | null,
  now: Date,
): void {
  let area = plan.searchArea;
  if (geocoded) area = area.movedTo(geocoded);
  else if (edit.label !== undefined && edit.lat !== undefined && edit.lng !== undefined) {
    area = area.movedTo({ label: edit.label, lat: edit.lat, lng: edit.lng });
  }
  if (edit.radiusMiles !== undefined) area = area.withRadius(edit.radiusMiles);
  plan.changeSearchArea(area, now);
}
