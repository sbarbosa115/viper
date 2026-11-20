import { MAX_PLAN_NAME } from './plan.js';
import { clampRadius } from './search-area.js';
import {
  MAX_CHIP,
  MAX_EXCLUSIONS,
  MAX_FIT_SIGNALS,
  MAX_SEGMENT_NAME,
  MAX_SEGMENTS,
  type TargetSegmentValues,
} from './target-segment.js';

/** What the planning model proposes for a Goal, before the rules of FR-16 are applied. */
export interface PlanDraft {
  readonly name: string;
  readonly segments: readonly {
    readonly name: string;
    readonly fitSignals: readonly string[];
    readonly exclusions: readonly string[];
    readonly productId: string;
  }[];
  /** A place the goal names ("near Fredericksburg"), or null to use the profile location. */
  readonly place: string | null;
  /** A radius the goal states, or null to use the delivery radius. */
  readonly radiusMiles: number | null;
}

const KM_PER_MILE = 1.609344;

/** "within 3 miles", "5 mi", "10km" → miles; null when the goal states no distance. */
export function radiusFromGoal(goal: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*-?\s*(miles?|mi|kilometers?|kilometres?|km)\b/i.exec(goal);
  if (!match?.[1] || !match[2]) return null;
  const value = Number(match[1]);
  return /^k/i.test(match[2]) ? value / KM_PER_MILE : value;
}

/** FR-16: radius from the goal (as drafted, else parsed), else the delivery radius; 1–25 miles. */
export function draftRadius(
  drafted: number | null,
  goal: string,
  deliveryRadiusMiles: number | null,
): number {
  const stated = drafted !== null && Number.isFinite(drafted) && drafted > 0 ? drafted : null;
  return clampRadius(stated ?? radiusFromGoal(goal) ?? deliveryRadiusMiles ?? 1);
}

const cut = (value: string, max: number) => value.trim().slice(0, max).trim();

function chips(values: readonly string[], max: number): string[] {
  return values
    .map((v) => cut(v, MAX_CHIP))
    .filter((v) => v.length > 0)
    .slice(0, max);
}

/**
 * Brings a drafted Plan within the rules (FR-16): name ≤ 60 (the goal when empty), 1–5 segments,
 * 1–6 Fit signals and 0–5 exclusions each, and a Product from the profile (the first Product when
 * the model named another). Segments with no name or no Fit signal are dropped. Returns null when
 * nothing usable is left.
 */
export function normaliseDraft(
  draft: PlanDraft,
  ctx: { goal: string; productIds: readonly string[]; newId: () => string },
): { name: string; segments: TargetSegmentValues[] } | null {
  const fallbackProduct = ctx.productIds[0];
  if (fallbackProduct === undefined) return null;
  const known = new Set(ctx.productIds);
  const segments = draft.segments
    .map((s) => ({
      name: cut(s.name, MAX_SEGMENT_NAME),
      fitSignals: chips(s.fitSignals, MAX_FIT_SIGNALS),
      exclusions: chips(s.exclusions, MAX_EXCLUSIONS),
      productId: known.has(s.productId) ? s.productId : fallbackProduct,
    }))
    .filter((s) => s.name.length > 0 && s.fitSignals.length > 0)
    .slice(0, MAX_SEGMENTS)
    .map((s) => ({ id: ctx.newId(), ...s }));
  if (segments.length === 0) return null;
  const name = cut(draft.name, MAX_PLAN_NAME) || cut(ctx.goal, MAX_PLAN_NAME);
  return { name, segments };
}
