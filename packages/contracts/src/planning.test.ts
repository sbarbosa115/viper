import { describe, expect, test } from 'vitest';
import * as ex from './examples.js';
import { createPlan, getPlan, listPlans, searchPlaces, updatePlan } from './planning.js';

describe('contracts: planning', () => {
  test('FR-16: create from a goal of 5–500 chars', () => {
    expect(createPlan.body.safeParse({ goal: 'bakeries within 3 miles' }).success).toBe(true);
    expect(createPlan.body.safeParse({ goal: 'abc' }).success).toBe(false);
    expect(createPlan.response.parse(ex.plan)).toEqual(ex.plan);
    expect(
      createPlan.response.safeParse({ ...ex.plan, warnings: ["We couldn't find 'Atlantis'"] })
        .success,
    ).toBe(true);
    expect(createPlan.errors).toContainEqual({ status: 422, code: 'PROFILE_INCOMPLETE' });
  });

  test('plan list omits segments', () => {
    const { segments: _s, ...summary } = ex.plan;
    expect(listPlans.response.safeParse({ items: [summary], nextCursor: null }).success).toBe(true);
    expect(
      listPlans.response.safeParse({ items: [{ ...summary, id: 1 }], nextCursor: null }).success,
    ).toBe(false);
  });

  test('FR-17: radius 30 → error naming searchArea.radiusMiles', () => {
    const res = updatePlan.body.safeParse({ searchArea: { radiusMiles: 30 } });
    expect(res.error?.issues.map((i) => i.path.join('.'))).toContain('searchArea.radiusMiles');
  });

  test('FR-17: search area by place query, or by a full point', () => {
    expect(
      updatePlan.body.safeParse({ searchArea: { query: 'Round Rock, TX', radiusMiles: 5 } })
        .success,
    ).toBe(true);
    expect(
      updatePlan.body.safeParse({ searchArea: { label: 'Austin', lat: 30.2, lng: -97.7 } }).success,
    ).toBe(true);
    expect(updatePlan.body.safeParse({ searchArea: { lat: 30.2 } }).success).toBe(false);
    expect(updatePlan.body.safeParse({ searchArea: {} }).success).toBe(false);
  });

  test('FR-17: segments 1–5, fit signals 1–6, exclusions ≤ 5, min Fit score 40–90', () => {
    const segment = {
      name: 'Bakeries',
      fitSignals: ['Bakes on site'],
      exclusions: [],
      productId: ex.ids.product,
    };
    expect(updatePlan.body.safeParse({ segments: [segment] }).success).toBe(true);
    expect(updatePlan.body.safeParse({ segments: [] }).success).toBe(false);
    expect(updatePlan.body.safeParse({ segments: Array(6).fill(segment) }).success).toBe(false);
    expect(updatePlan.body.safeParse({ segments: [{ ...segment, fitSignals: [] }] }).success).toBe(
      false,
    );
    expect(
      updatePlan.body.safeParse({ guardrails: { maxCredits: 400, maxLeads: 50, minFitScore: 95 } })
        .success,
    ).toBe(false);
    expect(
      getPlan.response.safeParse({
        ...ex.plan,
        guardrails: { maxCredits: 5, maxLeads: 50, minFitScore: 60 },
      }).success,
    ).toBe(false);
  });

  test('place search returns at most 5 places', () => {
    expect(searchPlaces.query.safeParse({ q: 'Austin' }).success).toBe(true);
    expect(searchPlaces.query.safeParse({ q: 'A' }).success).toBe(false);
    const p = { label: 'Austin, TX', lat: 30.2, lng: -97.7 };
    expect(searchPlaces.response.safeParse({ items: [p] }).success).toBe(true);
    expect(searchPlaces.response.safeParse({ items: Array(6).fill(p) }).success).toBe(false);
  });
});
