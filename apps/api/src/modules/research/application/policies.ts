import type { Actor } from '../../../shared/domain/actor.js';
import {
  CodedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/domain/errors.js';
import type { RunPageCursor } from './ports.js';

/** Runs belong to the Actor's Business (the target while Acting as); the Owner starts them. */
export function assertOwner(actor: Actor): void {
  if (!actor.roles.includes('owner')) throw new ForbiddenError('Only the Owner can run research');
}

/** FR-18: only a verified email may start or resume a run. */
export function assertVerified(actor: Actor): void {
  if (!actor.emailVerified) {
    throw new CodedError('EMAIL_NOT_VERIFIED', 'Verify your email to start research');
  }
}

/** Back-office use cases need Staff who passed two-factor (FR-5). */
export function requireStaff(actor: Actor): void {
  if (!actor.roles.includes('staff')) throw new ForbiddenError('Staff only');
}

export const runNotFound = (id: string) => new NotFoundError('Run not found', { runId: id });

export const runInProgress = () =>
  new CodedError('RUN_IN_PROGRESS', 'A research run is already in progress for this Business');

export function encodeRunCursor(c: RunPageCursor): string {
  return Buffer.from(`${c.queuedAt.toISOString()}|${c.id}`).toString('base64url');
}

export function decodeRunCursor(cursor: string | undefined): RunPageCursor | undefined {
  if (!cursor) return undefined;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const queuedAt = new Date(at ?? '');
  if (!id || Number.isNaN(queuedAt.getTime())) {
    throw new ValidationError('Invalid cursor', { cursor: 'Invalid cursor' });
  }
  return { queuedAt, id };
}
