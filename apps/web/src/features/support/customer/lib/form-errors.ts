import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import type { $ZodRawIssue } from 'zod/v4/core';
import { ApiError } from '../../../../shared/api/client';
import { copy } from '../../copy';

/** Plain-language messages for the contract schema's default zod issues. */
export function friendlyIssue(issue: $ZodRawIssue): string | undefined {
  const field = issue.path?.[0];
  const tooSmall = issue.code === 'too_small';
  const tooBig = issue.code === 'too_big';
  if (issue.code === 'invalid_type' || issue.code === 'invalid_value') {
    return field === 'category' ? copy.categoryRequired : copy.required;
  }
  if (field === 'subject' && tooSmall) return copy.subjectShort;
  if (field === 'subject' && tooBig) return copy.subjectLong;
  if (field === 'message' && tooSmall) return copy.messageShort;
  if (field === 'message' && tooBig) return copy.messageLong;
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
