import type { RunFailureCode } from '../domain/run.js';

/**
 * How an attempt can end early (FR-36). Final errors fail the run at once; retryable ones end the
 * attempt and queue the next one while attempts and total time remain.
 */
export class FinalRunError extends Error {
  constructor(
    readonly code: RunFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'FinalRunError';
  }
}

export class RetryableRunError extends Error {
  constructor(
    readonly code: RunFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'RetryableRunError';
  }
}

/** The sweeper ended this attempt (its lease expired): the worker stops without writing. */
export class LeaseLostError extends Error {
  constructor() {
    super('The attempt lease was lost');
    this.name = 'LeaseLostError';
  }
}

/** Cancel was requested; the current Tool call has finished (FR-21). */
export class CancelRequestedSignal extends Error {
  constructor() {
    super('Cancel requested');
    this.name = 'CancelRequestedSignal';
  }
}

/**
 * A Tool call would exceed the run's budget (FR-20 hard stop): the run delivers what it has, and
 * fails with INSUFFICIENT_CREDITS only when that is nothing (FR-36).
 */
export class BudgetExhaustedSignal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExhaustedSignal';
  }
}

/** Test hook (AJ-9): the worker "stops" as if it crashed, leaving the attempt to the sweeper. */
export class WorkerStopSignal extends Error {
  constructor() {
    super('Worker stopped by the test hook');
    this.name = 'WorkerStopSignal';
  }
}

/** Tool-call error codes meaning the run's budget can't pay for the call (FR-20 hard stop). */
export const BUDGET_TOOL_ERRORS: readonly string[] = ['BUDGET_EXCEEDED', 'INSUFFICIENT_CREDITS'];

/** Tool-call errors worth retrying with backoff (FR-20: 1 s, 4 s, 16 s). */
export const RETRYABLE_TOOL_ERRORS: readonly string[] = [
  'PROVIDER_ERROR',
  'RATE_LIMITED',
  'TIMEOUT',
  'INTERNAL_ERROR',
];

/** Tool-call errors that switch the Tool off for the rest of the run. */
export const TOOL_OFF_ERRORS: readonly string[] = ['TOOL_DISABLED', 'PROVIDER_NOT_CONFIGURED'];

export const PROVIDER_BACKOFF_MS: readonly number[] = [1_000, 4_000, 16_000];

/**
 * The worker is shutting down (SIGTERM, a deploy): the attempt stops at its next save, or after a
 * short grace if a call is in flight, and ends as a retryable `worker_stopped` (FR-36).
 */
export class WorkerShutdownSignal extends Error {
  constructor() {
    super('The worker shut down');
    this.name = 'WorkerShutdownSignal';
  }
}
