import { errorResponse } from '@app/contracts/errors';
import { flow as example } from '@app/contracts/examples';
import {
  flowInput,
  getFlow,
  listFlows,
  localBuyersStepKeys,
  updateFlow,
  type Flow,
} from '@app/contracts/research';
import { http, HttpResponse } from 'msw';

const names = [
  'Search terms',
  'Maps & places',
  'Merge',
  'Pre-score',
  'Websites',
  'Socials & reviews',
  'Contacts',
  'Verify',
  'Score & pitch',
  'Deliver',
];
const tools: string[][] = [
  ['anthropic.fast'],
  ['google.places', 'apify.maps', 'overpass'],
  [],
  ['anthropic.fast'],
  ['firecrawl.scrape', 'anthropic.fast'],
  ['apify.instagram', 'apify.yelp'],
  ['apollo.enrich', 'hunter.domain-search'],
  ['zerobounce.validate', 'twilio.lookup'],
  ['anthropic.messages'],
  [],
];
const budgets = [3, 18, 2, 6, 25, 10, 8, 6, 20, 2];
const minutes = [2, 12, 1, 3, 15, 8, 5, 5, 8, 1];

export const localBuyers: Flow = {
  ...example,
  version: 3,
  ceilings: {
    maxCredits: 1000,
    maxLeads: 500,
    maxActiveMinutes: 120,
    maxTotalHours: 4,
    maxAttempts: 5,
    trialCredits: 50,
  },
  steps: localBuyersStepKeys.map((key, i) => ({
    key,
    name: names[i]!,
    tools: tools[i]!,
    budgetPct: budgets[i]!,
    timeLimitMinutes: minutes[i]!,
    required: i !== 5 && i !== 6,
  })),
};

export const flowsState: {
  flow: Flow;
  saves: unknown[];
  lastSaved: unknown;
} = { flow: localBuyers, saves: [], lastSaved: null };

export function resetFlowsState() {
  flowsState.flow = localBuyers;
  flowsState.saves = [];
}
resetFlowsState();

export const handlers = [
  http.get('*/api/staff/flows', () =>
    HttpResponse.json(
      listFlows.response.parse({
        items: [
          {
            key: flowsState.flow.key,
            name: flowsState.flow.name,
            version: flowsState.flow.version,
            isDefault: true,
            plansUsing: 12,
            updatedAt: '2026-11-19T10:00:00.000Z',
          },
        ],
        nextCursor: null,
      }),
    ),
  ),

  http.get('*/api/staff/flows/:key', ({ params }) =>
    params.key === flowsState.flow.key
      ? HttpResponse.json(getFlow.response.parse(flowsState.flow))
      : HttpResponse.json(
          errorResponse.parse({ error: { code: 'NOT_FOUND', message: 'No flow' } }),
          {
            status: 404,
          },
        ),
  ),

  http.put('*/api/staff/flows/:key', async ({ request }) => {
    const body: unknown = await request.json();
    const parsed = flowInput.safeParse(body);
    if (!parsed.success) {
      return HttpResponse.json(
        errorResponse.parse({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid',
            fields: { steps: 'Step budget shares must add up to 100%' },
          },
        }),
        { status: 400 },
      );
    }
    flowsState.saves.push(body);
    flowsState.flow = {
      ...flowsState.flow,
      ...parsed.data,
      version: flowsState.flow.version + 1,
    };
    return HttpResponse.json(updateFlow.response.parse(flowsState.flow), { status: 201 });
  }),
];
