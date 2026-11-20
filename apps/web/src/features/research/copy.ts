import type { RunFailureCode } from '@app/contracts/errors';

/** Customer-facing strings of the research feature. Never names Tools, attempts or errors. */
export const copy = {
  workingTitle: 'Working on it',
  waiting: 'Waiting to start',
  soFar: '{time} so far',
  planMeta: '{plan} · {time}',
  checklist: 'Research steps',
  stepDone: 'done',
  stepCurrent: 'in progress',
  stepTodo: 'to do',
  stepFailed: 'failed',
  emailNote: "We'll email you when your leads are ready. You can close this page.",
  takingLonger:
    "Taking a little longer than usual. We're still on it and you won't be charged twice for work already done.",
  cancelRun: 'Cancel run',
  cancelTitle: 'Cancel this run?',
  cancelBody:
    "We'll stop after the current step finishes. You're only charged for the work done so far.",
  keepGoing: 'Keep going',
  confirmCancel: 'Yes, cancel run',
  cancelling: "Cancelling. We'll stop after the current step finishes.",
  cancelFailed: "We couldn't cancel this run. Try again.",
  // Completed
  readyTitle: '{leads} ready · {credits} credits · {perLead} per lead',
  leadOne: '1 lead',
  leadMany: '{n} leads',
  seeLeads: 'See leads',
  backToPlan: 'Back to plan',
  // Cancelled
  cancelledTitle: 'This run was cancelled',
  cancelledCharged: 'You were charged {n} credits for the work done.',
  // Failed
  failedTitle: "This run didn't finish",
  failedCharged: 'You were charged {n} credits.',
  tryAgain: 'Try again',
  tryAgainNote: "Picks up where it stopped. Work already done isn't charged again.",
  tryAgainFailed: "We couldn't restart this run. Try again in a moment.",
  // Credits dialog (resume has no lower-budget option)
  needTitle: 'You need {required} credits, you have {available}',
  needTitleUnknown: 'You need more credits to continue',
  needBody: 'Buy credits, then try again. Work already done is not charged twice.',
  buyCredits: 'Buy credits',
  cancel: 'Cancel',
  // Load states
  loadFailed: 'We could not load this run. Try again.',
  notFound: 'Run not found',
  notFoundBody: 'It may have been removed, or it belongs to another business.',
  loading: 'Loading run',
} as const;

export const fill = (text: string, vars: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_m, key: string) => String(vars[key] ?? ''));

/** The reason a run didn't finish, in plain words. */
export const failureReasons: Record<RunFailureCode, string> = {
  PROVIDER_ERROR:
    "One of our data sources didn't respond, so we couldn't finish finding businesses.",
  PROVIDER_NOT_CONFIGURED: "A data source isn't available right now, so we couldn't finish.",
  TOOL_DISABLED: "A data source isn't available right now, so we couldn't finish.",
  TIME_LIMIT: 'The research took longer than we allow, so we stopped it.',
  INSUFFICIENT_CREDITS: 'The run ran out of credits before it could finish.',
  INVALID_PLAN: "We couldn't use this plan as written. Check its target types and search area.",
  INTERNAL_ERROR: 'Something went wrong on our side.',
};
export const genericFailure = 'Something went wrong, so we stopped the run.';
