import { errorResponse } from '@app/contracts/errors';
import { ids, lead as leadExample, runSummary as runExample } from '@app/contracts/examples';
import {
  lead as leadSchema,
  leadFilters,
  leadSummary,
  listLeads,
  setLeadFeedback,
  type Lead,
} from '@app/contracts/leads';
import { listPlanRuns, runSummary } from '@app/contracts/research';
import { http, HttpResponse } from 'msw';

const at = (day: number) => `2026-11-${String(day).padStart(2, '0')}T10:00:00.000Z`;
export const otherRunId = '0193a1b2-0000-7000-8000-0000000000f6';

/** A Lead with a unique id, name and score. `n` is 1-based; scores fall as n grows. */
export function makeLead(n: number, patch: Partial<Lead> = {}): Lead {
  const hex = n.toString(16).padStart(4, '0');
  return leadSchema.parse({
    ...leadExample,
    id: `0193a1b2-0000-7000-8000-00000001${hex}`,
    name: `Bakery ${String(n).padStart(2, '0')}`,
    fitScore: Math.max(0, 100 - n),
    distanceMiles: n % 7,
    deliveredAt: at(((n - 1) % 28) + 1),
    ...patch,
  });
}

export const makeLeads = (count: number): Lead[] =>
  Array.from({ length: count }, (_, i) => makeLead(i + 1));

/** Tweak per test; `resetLeadsState()` restores the defaults (25 Leads on the example Plan). */
export const leadsState: {
  leads: Lead[];
  /** Every GET /plans/:id/leads URL. */
  listCalls: URL[];
  feedbackPuts: { id: string; body: unknown }[];
  runs: ReturnType<typeof runSummary.parse>[];
  failFeedback: boolean;
} = { leads: [], listCalls: [], feedbackPuts: [], runs: [], failFeedback: false };

export function resetLeadsState() {
  leadsState.leads = makeLeads(25);
  leadsState.listCalls = [];
  leadsState.feedbackPuts = [];
  leadsState.failFeedback = false;
  leadsState.runs = [
    runSummary.parse({ ...runExample, id: ids.run, leadsDelivered: 25, startedAt: at(18) }),
    runSummary.parse({ ...runExample, id: otherRunId, leadsDelivered: 3, startedAt: at(10) }),
  ];
}
resetLeadsState();

const fail = (status: number, code: string) =>
  HttpResponse.json(errorResponse.parse({ error: { code, message: code } }), { status });

/** The list row of a Lead: the contact kinds it has, not the contacts themselves. */
function toSummary(l: Lead) {
  const has = (type: string) => l.contacts.some((c) => c.type === type);
  return leadSummary.parse({
    id: l.id,
    name: l.name,
    category: l.category,
    distanceMiles: l.distanceMiles,
    fitScore: l.fitScore,
    contacts: {
      phone: has('phone'),
      email: has('email'),
      website: has('website'),
      instagram: has('instagram'),
      tiktok: has('tiktok'),
    },
    feedback: l.feedback,
    runId: l.runId,
    deliveredAt: l.deliveredAt,
  });
}

function stats(leads: Lead[]) {
  const total = leads.length;
  const contacts = leads.flatMap((l) => l.contacts);
  return {
    total,
    avgFitScore: total ? leads.reduce((s, l) => s + l.fitScore, 0) / total : null,
    verifiedPct: contacts.length
      ? (contacts.filter((c) => c.verification === 'verified').length / contacts.length) * 100
      : null,
    creditsSpent: 137,
    costPerLead: total ? 5.48 : null,
  };
}

export const handlers = [
  http.get('*/api/plans/:id/leads', ({ request }) => {
    const url = new URL(request.url);
    leadsState.listCalls.push(url);
    const query = listLeads.query.parse(Object.fromEntries(url.searchParams));
    const f = leadFilters.parse(Object.fromEntries(url.searchParams));
    const matching = leadsState.leads
      .filter((l) => !f.runId || l.runId === f.runId)
      .filter((l) => f.minScore === undefined || l.fitScore >= f.minScore)
      .filter(
        (l) =>
          !f.feedback || (f.feedback === 'none' ? l.feedback === null : l.feedback === f.feedback),
      )
      .filter((l) => !f.q || l.name.toLowerCase().includes(f.q.toLowerCase()))
      .sort((a, b) =>
        f.sort === 'distance'
          ? (a.distanceMiles ?? 1e9) - (b.distanceMiles ?? 1e9)
          : f.sort === 'newest'
            ? b.deliveredAt.localeCompare(a.deliveredAt)
            : b.fitScore - a.fitScore,
      );
    const start = Number(query.cursor ?? 0);
    const items = matching.slice(start, start + query.limit).map(toSummary);
    const next = start + query.limit;
    return HttpResponse.json(
      listLeads.response.parse({
        items,
        nextCursor: next < matching.length ? String(next) : null,
        stats: stats(matching),
      }),
    );
  }),

  http.get('*/api/plans/:id/runs', () =>
    HttpResponse.json(listPlanRuns.response.parse({ items: leadsState.runs, nextCursor: null })),
  ),

  http.get('*/api/leads/:id', ({ params }) => {
    const found = leadsState.leads.find((l) => l.id === params.id);
    return found ? HttpResponse.json(leadSchema.parse(found)) : fail(404, 'NOT_FOUND');
  }),

  http.put('*/api/leads/:id/feedback', async ({ request, params }) => {
    const body = setLeadFeedback.body.parse(await request.json());
    leadsState.feedbackPuts.push({ id: String(params.id), body });
    if (leadsState.failFeedback) return fail(500, 'INTERNAL_ERROR');
    const found = leadsState.leads.find((l) => l.id === params.id);
    if (!found) return fail(404, 'NOT_FOUND');
    const next: Lead = {
      ...found,
      feedback: body.value,
      feedbackReason: body.value === 'not_fit' ? (body.reason ?? null) : null,
    };
    leadsState.leads = leadsState.leads.map((l) => (l.id === next.id ? next : l));
    return HttpResponse.json(setLeadFeedback.response.parse(next));
  }),
];
