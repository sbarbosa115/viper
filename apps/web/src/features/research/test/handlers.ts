import { errorResponse, insufficientCreditsError } from '@app/contracts/errors';
import { ids, runSummary as runExample } from '@app/contracts/examples';
import { runSummary, type RunSummary } from '@app/contracts/research';
import { http, HttpResponse } from 'msw';

/** Tweak per test; `resetResearchState()` restores the defaults. */
export const researchState: {
  run: RunSummary | null;
  /** Answer for POST /runs/:id/resume: 202 restarts the run, 402 carries the shortfall. */
  resume: { status: 202 } | { status: 402; available: number; required: number } | { status: 409 };
  /** Answer for POST /runs/:id/cancel. */
  cancel: { status: 202 } | { status: 409 };
  reads: number;
  cancelled: number;
  resumed: number;
} = {
  run: null,
  resume: { status: 202 },
  cancel: { status: 202 },
  reads: 0,
  cancelled: 0,
  resumed: 0,
};

export function makeRun(patch: Partial<RunSummary> = {}): RunSummary {
  return runSummary.parse({ ...runExample, ...patch });
}

export function resetResearchState() {
  researchState.run = makeRun();
  researchState.resume = { status: 202 };
  researchState.cancel = { status: 202 };
  researchState.reads = 0;
  researchState.cancelled = 0;
  researchState.resumed = 0;
}
resetResearchState();

const fail = (status: number, code: string) =>
  HttpResponse.json(errorResponse.parse({ error: { code, message: code } }), { status });

export const handlers = [
  http.get('*/api/runs/:id', ({ params }) => {
    researchState.reads += 1;
    const run = researchState.run;
    return run && (params.id === run.id || params.id === ids.run)
      ? HttpResponse.json(runSummary.parse(run))
      : fail(404, 'NOT_FOUND');
  }),

  http.post('*/api/runs/:id/cancel', () => {
    researchState.cancelled += 1;
    if (researchState.cancel.status === 409 || !researchState.run) {
      return fail(409, 'RUN_NOT_ACTIVE');
    }
    // The run only becomes `cancelled` after the current Tool call finishes.
    return HttpResponse.json(runSummary.parse(researchState.run), { status: 202 });
  }),

  http.post('*/api/runs/:id/resume', () => {
    researchState.resumed += 1;
    const answer = researchState.resume;
    if (answer.status === 402) {
      return HttpResponse.json(
        insufficientCreditsError.parse({
          error: {
            code: 'INSUFFICIENT_CREDITS',
            message: 'Not enough credits',
            details: { available: answer.available, required: answer.required },
          },
        }),
        { status: 402 },
      );
    }
    if (answer.status === 409 || !researchState.run) return fail(409, 'RUN_IN_PROGRESS');
    researchState.run = makeRun({
      ...researchState.run,
      status: 'queued',
      failureReason: null,
      finishedAt: null,
      takingLonger: false,
    });
    return HttpResponse.json(runSummary.parse(researchState.run), { status: 202 });
  }),
];
