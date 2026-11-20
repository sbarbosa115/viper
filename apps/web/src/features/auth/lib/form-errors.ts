import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import type { $ZodRawIssue } from 'zod/v4/core';
import { ApiError } from '../../../shared/api/client';

/** Plain-language messages for the contract schemas' default zod issues. */
export function friendlyIssue(issue: $ZodRawIssue): string | undefined {
  const input = issue.input;
  if (issue.code === 'too_small' && typeof input === 'string' && input.trim() === '') {
    return 'Required';
  }
  if (issue.code === 'too_small' && typeof input === 'string') {
    return `Use at least ${String(issue.minimum)} characters`;
  }
  if (issue.code === 'too_big') return `Use at most ${String(issue.maximum)} characters`;
  if (issue.code === 'invalid_format' && issue.format === 'email') {
    if (typeof input === 'string' && input.trim() === '') return 'Required';
    return 'Enter a valid email address';
  }
  if (issue.code === 'invalid_type' && (input === undefined || input === null)) return 'Required';
  return undefined;
}

export const schemaOptions = { error: friendlyIssue };

/** Puts the API's per-field messages on their inputs. Returns true when any field was handled. */
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  names: readonly Path<T>[],
  setError: UseFormSetError<T>,
): boolean {
  if (!(error instanceof ApiError) || !error.fields) return false;
  let handled = false;
  for (const name of names) {
    const message = error.fields[name];
    if (message) {
      setError(name, { type: 'server', message });
      handled = true;
    }
  }
  return handled;
}

export const isApiError = (error: unknown, status: number, code?: string): error is ApiError =>
  error instanceof ApiError &&
  error.status === status &&
  (code === undefined || error.code === code);
