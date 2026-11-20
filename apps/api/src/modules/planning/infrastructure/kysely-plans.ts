import type { Kysely, Selectable, Transaction } from 'kysely';
import type { PlanningUnitOfWork, PlanPageCursor, PlanRepository } from '../application/ports.js';
import { Plan, type PlanSnapshot } from '../domain/plan.js';
import type { DB } from '../../../shared/infrastructure/db/schema.js';
import { KyselyUnitOfWork } from '../../../shared/infrastructure/db/unit-of-work.js';
import type { PlansTable, TargetSegmentsTable } from './tables.js';

type Db = Kysely<DB> | Transaction<DB>;

function toSnapshot(
  row: Selectable<PlansTable>,
  segments: readonly Selectable<TargetSegmentsTable>[],
): PlanSnapshot {
  return {
    id: row.id,
    businessId: row.business_id,
    flowKey: row.flow_key,
    name: row.name,
    goal: row.goal,
    segments: [...segments]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        name: s.name,
        fitSignals: s.fit_signals,
        exclusions: s.exclusions,
        productId: s.product_id,
      })),
    searchArea: {
      label: row.search_label,
      lat: Number(row.lat),
      lng: Number(row.lng),
      radiusMiles: Number(row.radius_miles),
    },
    guardrails: {
      maxCredits: row.max_credits,
      maxLeads: row.max_leads,
      minFitScore: row.min_fit_score,
    },
    icpEditedAt: row.icp_edited_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Plans and their Target segments in MySQL (`plans`, `target_segments`). */
export class KyselyPlanRepository implements PlanRepository {
  constructor(private readonly db: Db) {}

  async findById(businessId: string, planId: string): Promise<Plan | null> {
    const row = await this.db
      .selectFrom('plans')
      .selectAll()
      .where('id', '=', planId)
      .where('business_id', '=', businessId)
      .executeTakeFirst();
    if (!row) return null;
    const segments = await this.db
      .selectFrom('target_segments')
      .selectAll()
      .where('plan_id', '=', planId)
      .execute();
    return Plan.restore(toSnapshot(row, segments));
  }

  async save(plan: Plan): Promise<void> {
    const s = plan.toSnapshot();
    const values = {
      name: s.name,
      search_label: s.searchArea.label,
      lat: s.searchArea.lat,
      lng: s.searchArea.lng,
      radius_miles: s.searchArea.radiusMiles,
      max_credits: s.guardrails.maxCredits,
      max_leads: s.guardrails.maxLeads,
      min_fit_score: s.guardrails.minFitScore,
      icp_edited_at: s.icpEditedAt,
      updated_at: s.updatedAt,
    };
    await this.db
      .insertInto('plans')
      .values({
        id: s.id,
        business_id: s.businessId,
        flow_key: s.flowKey,
        goal: s.goal,
        created_at: s.createdAt,
        ...values,
      })
      .onDuplicateKeyUpdate(values)
      .execute();
    await this.db.deleteFrom('target_segments').where('plan_id', '=', s.id).execute();
    await this.db
      .insertInto('target_segments')
      .values(
        s.segments.map((seg, position) => ({
          id: seg.id,
          plan_id: s.id,
          name: seg.name,
          fit_signals: JSON.stringify(seg.fitSignals),
          exclusions: JSON.stringify(seg.exclusions),
          product_id: seg.productId,
          position,
        })),
      )
      .execute();
  }

  async list(
    businessId: string,
    page: { after?: PlanPageCursor; limit: number },
  ): Promise<PlanSnapshot[]> {
    const { after } = page;
    let query = this.db.selectFrom('plans').selectAll().where('business_id', '=', businessId);
    if (after) {
      query = query.where((eb) =>
        eb.or([
          eb('created_at', '<', after.createdAt),
          eb.and([eb('created_at', '=', after.createdAt), eb('id', '<', after.id)]),
        ]),
      );
    }
    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(page.limit)
      .execute();
    if (rows.length === 0) return [];
    const segments = await this.db
      .selectFrom('target_segments')
      .selectAll()
      .where(
        'plan_id',
        'in',
        rows.map((r) => r.id),
      )
      .execute();
    return rows.map((row) =>
      toSnapshot(
        row,
        segments.filter((s) => s.plan_id === row.id),
      ),
    );
  }

  async countCreatedSince(businessId: string, since: Date): Promise<number> {
    const row = await this.db
      .selectFrom('plans')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('business_id', '=', businessId)
      .where('created_at', '>=', since)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async productInUse(businessId: string, productId: string): Promise<boolean> {
    const hit = await this.db
      .selectFrom('target_segments')
      .innerJoin('plans', 'plans.id', 'target_segments.plan_id')
      .select('target_segments.id')
      .where('plans.business_id', '=', businessId)
      .where('target_segments.product_id', '=', productId)
      .limit(1)
      .executeTakeFirst();
    return hit !== undefined;
  }
}

/** planning's Unit of Work on a MySQL transaction. */
export function kyselyPlanningUnitOfWork(db: Kysely<DB>): PlanningUnitOfWork {
  return new KyselyUnitOfWork(db, (trx) => ({ plans: new KyselyPlanRepository(trx) }));
}
