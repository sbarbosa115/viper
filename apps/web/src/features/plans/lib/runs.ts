import type { RunSummary } from '@app/contracts/research';
import { z } from 'zod';

/** A run that is still going: the Plan page offers "View progress" instead of "Find leads". */
export const isActiveRun = (run: RunSummary | null | undefined): run is RunSummary =>
  run !== null && run !== undefined && ['queued', 'running', 'retrying'].includes(run.status);

const details = z.object({ available: z.int(), required: z.int() });

/**
 * The 402 body carries `details: { available, required }`. The shared ApiError may not expose
 * `details` yet, so fall back to the Plan's own numbers (max credits and the wallet balance).
 */
export function creditsShortfall(
  error: unknown,
  fallback: { available: number; required: number },
): { available: number; required: number } {
  const parsed = details.safeParse((error as { details?: unknown }).details);
  return parsed.success ? parsed.data : fallback;
}

const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
export const formatShortDate = (iso: string): string => date.format(new Date(iso));
