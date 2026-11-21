import { z } from 'zod';

/**
 * Every error code the API can return (PRD section 7 and section 6). Generic codes come from the
 * central error handler; the rest are documented per endpoint in each contract's `errors`.
 */
export const errorCode = z.enum([
  // Generic (central error handler)
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RULE_VIOLATION',
  'BAD_REQUEST',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  // Identity
  'EMAIL_TAKEN',
  'TOKEN_EXPIRED',
  'TOO_MANY_REQUESTS',
  'INVALID_CREDENTIALS',
  'INVALID_CODE',
  'TWO_FACTOR_REQUIRED',
  'TWO_FACTOR_LOCKED',
  'ACTING_AS_FORBIDDEN',
  'EMAIL_NOT_VERIFIED',
  // Billing
  'PAYMENTS_UNAVAILABLE',
  'INVALID_SIGNATURE',
  'INSUFFICIENT_CREDITS',
  // Profile, assistant, planning
  'PRODUCT_IN_USE',
  'ADDRESS_NOT_FOUND',
  'ASSISTANT_UNAVAILABLE',
  'PROFILE_INCOMPLETE',
  'GEOCODER_UNAVAILABLE',
  // Research
  'RUN_IN_PROGRESS',
  'RESEARCH_UNAVAILABLE',
  'RUN_NOT_ACTIVE',
  'RUN_NOT_FAILED',
  'STEP_TIME_OVER_ACTIVE_TIME',
  // Finance
  'BEFORE_HISTORY_START',
  'FUTURE_MONTH',
  'UNKNOWN_PROVIDER',
  'PROVIDER_ALREADY_COVERED',
  'COVERS_PROVIDER_CATEGORY',
  'NOT_RECURRING',
  'EFFECTIVE_BEFORE_START',
  'FIRST_VERSION',
  'HAS_CHARGES',
  'NO_INVOICE',
  // Support
  'OPEN_TICKET_LIMIT',
  'UNKNOWN_RUN',
  'NOT_WHILE_ACTING_AS',
  'TICKET_NOT_FOUND',
  'TICKET_CLOSED_TOO_LONG',
  'ALREADY_CLOSED',
  'TICKET_CLOSED',
  'VERSION_CONFLICT',
  'UNKNOWN_STAFF',
]);
export type ErrorCode = z.infer<typeof errorCode>;

/**
 * Why a Research run failed (`RunSummary.failureReason` carries one of these, or null) and the
 * results a Tool call can end with (FR-20, FR-23, FR-36). Not HTTP error codes.
 */
export const runFailureCode = z.enum([
  'PROVIDER_ERROR',
  'PROVIDER_NOT_CONFIGURED',
  'TOOL_DISABLED',
  'TIME_LIMIT',
  'INSUFFICIENT_CREDITS',
  'INVALID_PLAN',
  'INTERNAL_ERROR',
]);
export type RunFailureCode = z.infer<typeof runFailureCode>;

/**
 * The shared error shape for every non-2xx JSON response (PRD section 7).
 * `fields` maps a request path (e.g. `searchArea.radiusMiles`) to a message (400s).
 * `details` carries structured data for codes that document it (e.g. INSUFFICIENT_CREDITS).
 * `code` stays a string so clients keep working when a new code is added.
 */
export const errorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z.record(z.string(), z.string()).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponse>;

/** 402 INSUFFICIENT_CREDITS from starting or resuming a run (FR-18): `details: { available, required }`. */
export const insufficientCreditsError = z.object({
  error: z.object({
    code: z.literal('INSUFFICIENT_CREDITS'),
    message: z.string(),
    details: z.object({ available: z.int(), required: z.int() }),
  }),
});
export type InsufficientCreditsError = z.infer<typeof insufficientCreditsError>;
