import type { PlanningUnitOfWork, PlanPageCursor, PlanRepository } from '../application/ports.js';
import { Plan, type PlanSnapshot } from '../domain/plan.js';

function after(s: PlanSnapshot, cursor: PlanPageCursor): boolean {
  const t = s.createdAt.getTime();
  const c = cursor.createdAt.getTime();
  return t < c || (t === c && s.id < cursor.id);
}

/**
 * Plans in memory (tests, and other modules' tests through createInMemoryPlanning). Stores cloned
 * snapshots, so a change made without `save()` is lost, as with the database.
 */
export class InMemoryPlans implements PlanRepository, PlanningUnitOfWork {
  private readonly rows = new Map<string, PlanSnapshot>();

  run<T>(fn: (repos: { plans: PlanRepository }) => Promise<T>): Promise<T> {
    return fn({ plans: this });
  }

  findById(businessId: string, planId: string): Promise<Plan | null> {
    const row = this.rows.get(planId);
    return Promise.resolve(
      row?.businessId === businessId ? Plan.restore(structuredClone(row)) : null,
    );
  }

  save(plan: Plan): Promise<void> {
    this.rows.set(plan.id, structuredClone(plan.toSnapshot()));
    return Promise.resolve();
  }

  list(
    businessId: string,
    page: { after?: PlanPageCursor; limit: number },
  ): Promise<PlanSnapshot[]> {
    const rows = [...this.rows.values()]
      .filter((s) => s.businessId === businessId && (!page.after || after(s, page.after)))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, page.limit);
    return Promise.resolve(rows.map((r) => structuredClone(r)));
  }

  productInUse(businessId: string, productId: string): Promise<boolean> {
    return Promise.resolve(
      [...this.rows.values()].some(
        (s) => s.businessId === businessId && s.segments.some((seg) => seg.productId === productId),
      ),
    );
  }

  countCreatedSince(businessId: string, since: Date): Promise<number> {
    return Promise.resolve(
      [...this.rows.values()].filter(
        (s) => s.businessId === businessId && s.createdAt.getTime() >= since.getTime(),
      ).length,
    );
  }

  /** Every stored Plan (assertions). */
  all(): PlanSnapshot[] {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }
}
