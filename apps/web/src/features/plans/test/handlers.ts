import { errorResponse } from '@app/contracts/errors';
import { ids, plan as planExample } from '@app/contracts/examples';
import {
  createPlan,
  plan as planSchema,
  planSummary,
  searchPlaces,
  updatePlan,
  updatePlanBody,
  type Place,
  type Plan,
} from '@app/contracts/planning';
import { page } from '@app/contracts/common';
import { http, HttpResponse } from 'msw';

/** Tweak per test; `resetPlansState()` restores the defaults. */
export const plansState: {
  plans: Plan[];
  /** Overrides the next POST /api/plans: an error status, or `warnings` on the created plan. */
  create: { status: 201; warnings?: string[] } | { status: 422 | 503 };
  created: unknown[];
  patched: unknown[];
  /** Fields the next PATCH refuses (400). */
  patchFields: Record<string, string> | null;
  places: Place[];
  searched: string[];
} = {
  plans: [],
  create: { status: 201 },
  created: [],
  patched: [],
  patchFields: null,
  places: [],
  searched: [],
};

export function resetPlansState() {
  plansState.plans = [planSchema.parse(planExample)];
  plansState.create = { status: 201 };
  plansState.created = [];
  plansState.patched = [];
  plansState.patchFields = null;
  plansState.places = [{ label: 'Round Rock, TX', lat: 30.5083, lng: -97.6789 }];
  plansState.searched = [];
}
resetPlansState();

function fail(status: number, code: string, fields?: Record<string, string>) {
  return HttpResponse.json(errorResponse.parse({ error: { code, message: code, fields } }), {
    status,
  });
}

const listResponse = page(planSummary);

export const handlers = [
  http.get('*/api/plans', () => {
    const items = plansState.plans.map(({ segments: _s, warnings: _w, ...summary }) => summary);
    return HttpResponse.json(listResponse.parse({ items, nextCursor: null }));
  }),

  http.post('*/api/plans', async ({ request }) => {
    const body = createPlan.body.parse(await request.json());
    plansState.created.push(body);
    const mode = plansState.create;
    if (mode.status !== 201) {
      return fail(
        mode.status,
        mode.status === 422 ? 'PROFILE_INCOMPLETE' : 'ASSISTANT_UNAVAILABLE',
      );
    }
    const created = planSchema.parse({
      ...planExample,
      id: ids.plan,
      goal: body.goal,
      lastRun: null,
      leadsCount: 0,
      ...(mode.warnings ? { warnings: mode.warnings } : {}),
    });
    plansState.plans = [created, ...plansState.plans];
    return HttpResponse.json(created, { status: 201 });
  }),

  http.get('*/api/plans/:id', ({ params }) => {
    const found = plansState.plans.find((p) => p.id === params.id);
    return found ? HttpResponse.json(planSchema.parse(found)) : fail(404, 'NOT_FOUND');
  }),

  http.patch('*/api/plans/:id', async ({ request, params }) => {
    const parsed = updatePlanBody.safeParse(await request.json());
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.join('.')] = issue.message;
      return fail(400, 'VALIDATION_ERROR', fields);
    }
    if (plansState.patchFields) return fail(400, 'VALIDATION_ERROR', plansState.patchFields);
    const found = plansState.plans.find((p) => p.id === params.id);
    if (!found) return fail(404, 'NOT_FOUND');
    plansState.patched.push(parsed.data);
    const { searchArea, guardrails, segments, name } = parsed.data;
    const next: Plan = {
      ...found,
      ...(name === undefined ? {} : { name }),
      ...(guardrails
        ? { guardrails, estimate: { ...found.estimate, maxCredits: guardrails.maxCredits } }
        : {}),
      ...(segments
        ? {
            segments: segments.map((s, i) => ({
              ...s,
              id: s.id ?? `0193a1b2-0000-7000-8000-0000000008${String(i).padStart(2, '0')}`,
            })),
          }
        : {}),
      ...(searchArea?.label && searchArea.lat !== undefined && searchArea.lng !== undefined
        ? {
            searchArea: {
              label: searchArea.label,
              lat: searchArea.lat,
              lng: searchArea.lng,
              radiusMiles: searchArea.radiusMiles ?? found.searchArea.radiusMiles,
            },
          }
        : searchArea?.radiusMiles
          ? { searchArea: { ...found.searchArea, radiusMiles: searchArea.radiusMiles } }
          : {}),
    };
    plansState.plans = plansState.plans.map((p) => (p.id === next.id ? next : p));
    return HttpResponse.json(updatePlan.response.parse(next));
  }),

  http.get('*/api/places/search', ({ request }) => {
    const q = new URL(request.url).searchParams.get('q') ?? '';
    plansState.searched.push(q);
    return HttpResponse.json(searchPlaces.response.parse({ items: plansState.places }));
  }),
];
