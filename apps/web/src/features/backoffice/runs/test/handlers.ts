import { errorResponse } from '@app/contracts/errors';
import { ids, runSummary, staffRunDetail, staffRunSummary } from '@app/contracts/examples';
import {
  getQueueHealth,
  getStaffRun,
  listStaffRuns,
  resumeStaffRun,
  type StaffRunDetail,
  type StaffRunSummary,
} from '@app/contracts/research';
import { http, HttpResponse } from 'msw';

const rid = (n: number) => `0193a1b2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 19, 10, minutes)).toISOString();

const steps = [
  { key: 'search-terms', name: 'Search terms', status: 'done' },
  { key: 'maps-places', name: 'Maps & places', status: 'done' },
  { key: 'websites', name: 'Websites', status: 'running' },
] as const;

export const retryingRun: StaffRunSummary = {
  ...staffRunSummary,
  id: rid(701),
  business: { id: rid(801), name: 'Hill Country Linens' },
  planName: 'Hotels near Fredericksburg',
  flow: { key: 'local-buyers', version: 3 },
  status: 'retrying',
  attempt: { current: 2, max: 3 },
  steps: steps.map((s) => ({ ...s })),
  resumeFromStep: 'websites',
  nextAttemptAt: at(30),
  finishedAt: null,
  leadsDelivered: 0,
};
export const runningRun: StaffRunSummary = {
  ...staffRunSummary,
  id: rid(702),
  business: { id: rid(802), name: 'Austin Party Rentals' },
  planName: 'Event venues in Austin',
  status: 'running',
  attempt: { current: 1, max: 3 },
  startedBy: 'staff',
  steps: steps.map((s) => ({ ...s })),
  finishedAt: null,
  leadsDelivered: 0,
};
export const completedRun: StaffRunSummary = {
  ...staffRunSummary,
  id: ids.run,
  budgetReached: true,
};
export const failedRun: StaffRunSummary = {
  ...staffRunSummary,
  id: rid(703),
  business: { id: rid(803), name: 'Corner Coffee Roasters' },
  planName: 'Offices in East Austin',
  status: 'failed',
  attempt: { current: 3, max: 3 },
  failureReason: 'PROVIDER_ERROR',
  leadsDelivered: 0,
  creditsSpent: 0,
};

const baseCall = staffRunDetail.steps[0]!.toolCalls[0]!;

export const failedDetail: StaffRunDetail = {
  ...staffRunDetail,
  ...failedRun,
  steps: [
    {
      key: 'search-terms',
      name: 'Search terms',
      status: 'done',
      creditsSpent: 2,
      durationS: 38,
      checkpointBytes: 1024,
      error: null,
      toolCalls: [
        {
          ...baseCall,
          id: rid(901),
          toolKey: 'anthropic.fast',
          attempt: 1,
          reused: false,
          units: 4600,
          millicredits: 230,
        },
      ],
    },
    {
      key: 'websites',
      name: 'Websites',
      status: 'failed',
      creditsSpent: 45.6,
      durationS: 860,
      checkpointBytes: 66 * 1024,
      error: 'Provider returned 500',
      toolCalls: [
        { ...baseCall, id: rid(902), attempt: 1, reused: false, millicredits: 800 },
        { ...baseCall, id: rid(903), attempt: 2, reused: true, millicredits: 0 },
        { ...baseCall, id: rid(904), attempt: 2, reused: true, millicredits: 0 },
        {
          ...baseCall,
          id: rid(905),
          attempt: 2,
          reused: false,
          status: 'error',
          error: '429 rate limited',
          millicredits: 0,
        },
      ],
    },
  ],
  attempts: [
    {
      n: 1,
      startedAt: at(2),
      endedAt: at(21),
      outcome: 'worker_stopped',
      from: { stepKey: 'search-terms', item: 0 },
      reached: { stepKey: 'websites', item: 12 },
      error: 'no heartbeat for 2 min',
      handoff: {
        stepKey: 'websites',
        itemsDone: 12,
        itemsLeft: 18,
        notes: "- 74 hotels after merging\n- Look for 'events' pages",
        lastError: 'lease expired at 10:21:40',
        creditsLeft: 288,
        activeSecondsLeft: 2460,
      },
    },
    {
      n: 2,
      startedAt: at(23),
      endedAt: at(40),
      outcome: 'retryable_error',
      from: { stepKey: 'websites', item: 12 },
      reached: { stepKey: 'websites', item: 20 },
      error: 'Provider returned 500',
      handoff: {
        stepKey: 'websites',
        itemsDone: 20,
        itemsLeft: 10,
        notes: 'Provider flaky',
        lastError: 'Provider returned 500',
        creditsLeft: 200,
        activeSecondsLeft: 1500,
      },
    },
    {
      n: 3,
      startedAt: at(45),
      endedAt: at(50),
      outcome: 'final_error',
      from: { stepKey: 'websites', item: 20 },
      reached: null,
      error: 'Provider returned 500',
      handoff: null,
    },
  ],
};

export const runsState: {
  runs: StaffRunSummary[];
  detail: StaffRunDetail;
  queue: ReturnType<typeof getQueueHealth.response.parse>;
  queries: Record<string, string>[];
  resumes: string[];
  resumeError: 'credits' | 'busy' | null;
} = {
  runs: [],
  detail: failedDetail,
  queue: getQueueHealth.response.parse({
    waiting: 0,
    active: 2,
    failed: 1,
    delayed: 0,
    retrying: 1,
    stalledFound: 0,
    sweeperLastRunAt: new Date().toISOString(),
    workerLastSeenAt: new Date().toISOString(),
  }),
  queries: [],
  resumes: [],
  resumeError: null,
};

export function resetRunsState() {
  runsState.runs = [retryingRun, runningRun, completedRun, failedRun];
  runsState.detail = failedDetail;
  runsState.queue = getQueueHealth.response.parse({
    waiting: 0,
    active: 2,
    failed: 1,
    delayed: 0,
    retrying: 1,
    stalledFound: 0,
    sweeperLastRunAt: new Date(Date.now() - 40_000).toISOString(),
    workerLastSeenAt: new Date(Date.now() - 12_000).toISOString(),
  });
  runsState.queries = [];
  runsState.resumes = [];
  runsState.resumeError = null;
}
resetRunsState();

const notFound = () =>
  HttpResponse.json(errorResponse.parse({ error: { code: 'NOT_FOUND', message: 'No run' } }), {
    status: 404,
  });

export const handlers = [
  http.get('*/api/staff/runs', ({ request }) => {
    const raw = Object.fromEntries(new URL(request.url).searchParams);
    runsState.queries.push(raw);
    const query = listStaffRuns.query.parse(raw);
    const matching = runsState.runs.filter(
      (r) =>
        (!query.status || r.status === query.status) &&
        (!query.businessId || r.business.id === query.businessId),
    );
    const start = Number(query.cursor ?? 0);
    const items = matching.slice(start, start + query.limit);
    const next = start + query.limit;
    return HttpResponse.json(
      listStaffRuns.response.parse({
        items,
        nextCursor: next < matching.length ? String(next) : null,
      }),
    );
  }),

  http.get('*/api/staff/queue', () =>
    HttpResponse.json(getQueueHealth.response.parse(runsState.queue)),
  ),

  http.get('*/api/staff/runs/:id', ({ params }) =>
    String(params.id) === runsState.detail.id
      ? HttpResponse.json(getStaffRun.response.parse(runsState.detail))
      : notFound(),
  ),

  http.post('*/api/staff/runs/:id/resume', ({ params }) => {
    if (runsState.resumeError === 'credits') {
      return HttpResponse.json(
        errorResponse.parse({
          error: {
            code: 'INSUFFICIENT_CREDITS',
            message: 'Not enough credits',
            details: { available: 12, required: 200 },
          },
        }),
        { status: 402 },
      );
    }
    if (runsState.resumeError === 'busy') {
      return HttpResponse.json(
        errorResponse.parse({ error: { code: 'RUN_IN_PROGRESS', message: 'Busy' } }),
        { status: 409 },
      );
    }
    runsState.resumes.push(String(params.id));
    runsState.detail = { ...runsState.detail, status: 'queued' };
    return HttpResponse.json(resumeStaffRun.response.parse({ ...runSummary, status: 'queued' }), {
      status: 202,
    });
  }),
];
