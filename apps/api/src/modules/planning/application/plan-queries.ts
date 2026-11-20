import type { Plan as PlanDto, PlanSummary } from '@app/contracts/planning';
import type { Geocoder } from '../../../shared/application/geocoder.js';
import type { Actor } from '../../../shared/domain/actor.js';
import { ValidationError } from '../../../shared/domain/errors.js';
import { estimate } from '../domain/estimate.js';
import type { PlanSnapshot } from '../domain/plan.js';
import { assertCanPlan } from './policies.js';
import type {
  PlanActivity,
  PlanningUnitOfWork,
  PlanPageCursor,
  RunStats,
  WalletReader,
} from './ports.js';
import { planNotFound } from './update-plan.js';

export interface PlanQueriesDeps {
  uow: PlanningUnitOfWork;
  runStats: RunStats;
  wallet: WalletReader;
  activity: PlanActivity;
  geocoder: Geocoder;
}

/** What research snapshots when a run starts (FR-18). Times are ISO 8601 UTC. */
export interface PlanForRun {
  id: string;
  businessId: string;
  flowKey: string;
  name: string;
  goal: string;
  segments: {
    id: string;
    name: string;
    fitSignals: string[];
    exclusions: string[];
    productId: string;
  }[];
  searchArea: { label: string; lat: number; lng: number; radiusMiles: number };
  guardrails: { maxCredits: number; maxLeads: number; minFitScore: number };
  icpEdited: boolean;
  updatedAt: string;
}

export function encodeCursor(c: PlanPageCursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`).toString('base64url');
}

export function decodeCursor(cursor: string): PlanPageCursor {
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(at ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) {
    throw new ValidationError('Invalid cursor', { cursor: 'Invalid cursor' });
  }
  return { createdAt, id };
}

/** Reads of Plans: the Plan screen with its estimate (FR-17), lists, and other contexts' needs. */
export class PlanQueries {
  constructor(private readonly deps: PlanQueriesDeps) {}

  async getPlan(actor: Actor, planId: string, warnings?: readonly string[]): Promise<PlanDto> {
    assertCanPlan(actor);
    const snapshot = await this.find(actor.businessId, planId);
    if (!snapshot) throw planNotFound(planId);
    const [view] = await this.views(actor.businessId, [snapshot]);
    if (!view) throw planNotFound(planId);
    return {
      ...view,
      segments: snapshot.segments.map((s) => ({
        id: s.id,
        name: s.name,
        fitSignals: [...s.fitSignals],
        exclusions: [...s.exclusions],
        productId: s.productId,
      })),
      ...(warnings && warnings.length > 0 ? { warnings: [...warnings] } : {}),
    };
  }

  /** GET /api/plans: newest first, cursor pagination, without segments. */
  async listPlans(
    actor: Actor,
    page: { cursor?: string | undefined; limit: number },
  ): Promise<{ items: PlanSummary[]; nextCursor: string | null }> {
    assertCanPlan(actor);
    const after = page.cursor ? decodeCursor(page.cursor) : undefined;
    const rows = await this.deps.uow.run(({ plans }) =>
      plans.list(actor.businessId, { ...(after ? { after } : {}), limit: page.limit + 1 }),
    );
    const pageRows = rows.slice(0, page.limit);
    const last = pageRows.at(-1);
    return {
      items: await this.views(actor.businessId, pageRows),
      nextCursor:
        rows.length > page.limit && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }

  /** For research's run start: the Plan as it is now, or null when it isn't the Business's. */
  async getPlanSnapshot(businessId: string, planId: string): Promise<PlanForRun | null> {
    const s = await this.find(businessId, planId);
    if (!s) return null;
    return {
      id: s.id,
      businessId: s.businessId,
      flowKey: s.flowKey,
      name: s.name,
      goal: s.goal,
      segments: s.segments.map((seg) => ({
        id: seg.id,
        name: seg.name,
        fitSignals: [...seg.fitSignals],
        exclusions: [...seg.exclusions],
        productId: seg.productId,
      })),
      searchArea: { ...s.searchArea },
      guardrails: { ...s.guardrails },
      icpEdited: s.icpEditedAt !== null,
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  /** profile's ProductUsage (FR-15: a Product used by a Target segment can't be deleted). */
  productInUse(businessId: string, productId: string): Promise<boolean> {
    return this.deps.uow.run(({ plans }) => plans.productInUse(businessId, productId));
  }

  /** GET /api/places/search: up to 5 geocoded places. */
  async searchPlaces(
    actor: Actor,
    q: string,
  ): Promise<{ items: { label: string; lat: number; lng: number }[] }> {
    assertCanPlan(actor);
    const hits = await this.deps.geocoder.search(q, 5);
    return { items: hits.slice(0, 5).map(({ label, lat, lng }) => ({ label, lat, lng })) };
  }

  private async find(businessId: string, planId: string): Promise<PlanSnapshot | null> {
    const plan = await this.deps.uow.run(({ plans }) => plans.findById(businessId, planId));
    return plan ? plan.toSnapshot() : null;
  }

  /** Plan summaries with estimate, available balance, last run and Lead count, batched. */
  private async views(
    businessId: string,
    snapshots: readonly PlanSnapshot[],
  ): Promise<PlanSummary[]> {
    if (snapshots.length === 0) return [];
    const planIds = snapshots.map((s) => s.id);
    const flowKeys = [...new Set(snapshots.map((s) => s.flowKey))];
    const [available, lastRuns, leadsCounts, typicals] = await Promise.all([
      this.deps.wallet.available(businessId),
      this.deps.activity.lastRuns(businessId, planIds),
      this.deps.activity.leadsCounts(businessId, planIds),
      Promise.all(
        flowKeys.map(async (k) => [k, await this.deps.runStats.typicalCredits(k)] as const),
      ),
    ]);
    const typicalByFlow = new Map(typicals);
    return snapshots.map((s) => ({
      id: s.id,
      name: s.name,
      goal: s.goal,
      searchArea: { ...s.searchArea },
      guardrails: { ...s.guardrails },
      icpEdited: s.icpEditedAt !== null,
      estimate: estimate(s.guardrails.maxCredits, typicalByFlow.get(s.flowKey) ?? null),
      available,
      lastRun: lastRuns.get(s.id) ?? null,
      leadsCount: leadsCounts.get(s.id) ?? 0,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }));
  }
}
