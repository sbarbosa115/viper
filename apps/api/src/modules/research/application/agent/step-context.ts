import type { AnalyticsTracker } from '../../../../shared/application/analytics-tracker.js';
import type { PlanSnapshot } from '../../domain/run.js';
import type { ProspectStorePort, SourceRef } from '../ports.js';

/** One unit of work inside a Step (a search term, a website, a contact to verify…). */
export interface WorkItem {
  readonly id: string;
  readonly label: string;
  /** What the agent sees about the item (and what Tool effects need). */
  readonly data: Readonly<Record<string, unknown>>;
  /** When set, only these Tools may be called for the item. */
  readonly tools?: readonly string[];
}

/** What Steps and Tool effects can read and write. */
export interface StepContext {
  readonly runId: string;
  readonly businessId: string;
  readonly attemptN: number;
  readonly plan: PlanSnapshot;
  readonly prospects: ProspectStorePort;
  readonly analytics: AnalyticsTracker;
  /** Earlier Steps' Checkpoints, by Step key. */
  readonly checkpoints: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  now(): Date;
}

/** A Source for a fact when the Tool's output carries none (NFR-5: every fact has one). */
export function fallbackSource(name: string, url: string | null, at: Date): SourceRef {
  return { name, url, retrievedAt: at.toISOString() };
}

/** `https://www.Example.com/x` → `example.com`. */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url.includes('://') ? url : `https://${url}`).hostname.toLowerCase();
    return host.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString).filter((s): s is string => s !== null) : [];
}
