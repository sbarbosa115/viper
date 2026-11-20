import { z } from 'zod';
import {
  credits,
  defineContract,
  err,
  id,
  idParams,
  isoDateTime,
  listQuery,
  page,
} from './common.js';
import { runSummary } from './research.js';

// Shapes -----------------------------------------------------------------------------------------

const chip = z.string().trim().min(1).max(80);

export const targetSegment = z.object({
  id,
  name: z.string(),
  fitSignals: z.array(z.string()),
  exclusions: z.array(z.string()),
  productId: id,
});
export type TargetSegment = z.infer<typeof targetSegment>;

/** A segment in an edit: `id` of an existing segment, or omitted for a new one. */
export const targetSegmentInput = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(60),
  fitSignals: z.array(chip).min(1).max(6),
  exclusions: z.array(chip).max(5),
  productId: id,
});
export type TargetSegmentInput = z.infer<typeof targetSegmentInput>;

export const radiusMiles = z.number().min(1).max(25);

export const searchArea = z.object({
  label: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusMiles,
});
export type SearchArea = z.infer<typeof searchArea>;

/**
 * A Search area edit: a place to geocode (`query`), or a resolved point (`label`, `lat`, `lng`),
 * with or without a new radius. A flat object so errors name `searchArea.radiusMiles`.
 */
export const searchAreaInput = z
  .object({
    query: z.string().trim().min(2).max(200).optional(),
    label: z.string().trim().min(1).max(200).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    radiusMiles: radiusMiles.optional(),
  })
  .superRefine((a, ctx) => {
    const point = [a.label, a.lat, a.lng].filter((v) => v !== undefined).length;
    if (point !== 0 && point !== 3) {
      ctx.addIssue({ code: 'custom', path: ['lat'], message: 'Give label, lat and lng together' });
    }
    if (a.query !== undefined && point === 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['query'],
        message: 'Give a place or a point, not both',
      });
    }
    if (a.query === undefined && point === 0 && a.radiusMiles === undefined) {
      ctx.addIssue({ code: 'custom', path: [], message: 'Nothing to change' });
    }
  });
export type SearchAreaInput = z.infer<typeof searchAreaInput>;

export const guardrails = z.object({
  maxCredits: credits.min(10),
  maxLeads: z.int().min(10),
  minFitScore: z.int().min(40).max(90),
});
export type Guardrails = z.infer<typeof guardrails>;

export const plan = z.object({
  id,
  name: z.string(),
  goal: z.string(),
  segments: z.array(targetSegment),
  searchArea,
  guardrails,
  icpEdited: z.boolean(),
  /** "Up to <maxCredits> credits · usually <typicalCredits>" (FR-17). */
  estimate: z.object({ maxCredits: credits, typicalCredits: credits }),
  /** The Credit wallet's available balance. */
  available: credits,
  lastRun: runSummary.nullable(),
  leadsCount: z.int().nonnegative(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  warnings: z.array(z.string()).optional(),
});
export type Plan = z.infer<typeof plan>;

export const planSummary = plan.omit({ segments: true, warnings: true });
export type PlanSummary = z.infer<typeof planSummary>;

/** Upper bounds (max credits, max leads) come from the flow and ceilings and are checked by the server. */
export const updatePlanBody = z
  .object({
    name: z.string().trim().min(1).max(60),
    segments: z.array(targetSegmentInput).min(1).max(5),
    searchArea: searchAreaInput,
    guardrails,
  })
  .partial();
export type UpdatePlanBody = z.infer<typeof updatePlanBody>;

export const place = z.object({
  label: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type Place = z.infer<typeof place>;

// Endpoints --------------------------------------------------------------------------------------

/** FR-16. */
export const createPlan = defineContract({
  method: 'POST',
  path: '/api/plans',
  auth: 'session',
  status: 201,
  body: z.object({ goal: z.string().trim().min(5).max(500) }),
  response: plan,
  errors: [err(422, 'PROFILE_INCOMPLETE'), err(503, 'ASSISTANT_UNAVAILABLE')],
});

/** Newest first. */
export const listPlans = defineContract({
  method: 'GET',
  path: '/api/plans',
  auth: 'session',
  status: 200,
  query: listQuery(25),
  response: page(planSummary),
});

export const getPlan = defineContract({
  method: 'GET',
  path: '/api/plans/:id',
  auth: 'session',
  status: 200,
  params: idParams,
  response: plan,
  errors: [err(404, 'NOT_FOUND')],
});

/** FR-17. */
export const updatePlan = defineContract({
  method: 'PATCH',
  path: '/api/plans/:id',
  auth: 'session',
  status: 200,
  params: idParams,
  body: updatePlanBody,
  response: plan,
  errors: [err(404, 'NOT_FOUND'), err(422, 'ADDRESS_NOT_FOUND')],
});

/** Geocoding search, at most 5 places. */
export const searchPlaces = defineContract({
  method: 'GET',
  path: '/api/places/search',
  auth: 'session',
  status: 200,
  query: z.object({ q: z.string().trim().min(2).max(200) }),
  response: z.object({ items: z.array(place).max(5) }),
});

export const planningContracts = {
  createPlan,
  listPlans,
  getPlan,
  updatePlan,
  searchPlaces,
} as const;
