import { settingsSectionInputs, type SettingsSection } from '@app/contracts/platform';
import type { $ZodRawIssue } from 'zod/v4/core';
import { copy } from '../copy';

function friendly(issue: $ZodRawIssue): string | undefined {
  const input = issue.input;
  if (issue.code === 'invalid_type' && (input === undefined || input === null))
    return copy.required;
  if (issue.code === 'too_small' && typeof input === 'string') return copy.required;
  if (issue.code === 'invalid_format' && issue.format === 'email')
    return 'Enter a valid email address';
  return undefined;
}

/** Checks a section body with the contract schema; returns messages by body path ({} when valid). */
export function validateSection(
  section: SettingsSection,
  body: Record<string, unknown>,
): Record<string, string> {
  const result = settingsSectionInputs[section].safeParse(body, { error: friendly });
  if (result.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.');
    errors[path] ??= issue.message;
  }
  return errors;
}
