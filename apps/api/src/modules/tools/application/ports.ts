import type { ToolStats } from '../domain/health.js';
import type { ToolSnapshot } from '../domain/tool.js';
import type { ProviderRequirement } from '../domain/tool-keys.js';

export interface ToolRepository {
  list(): Promise<ToolSnapshot[]>;
  find(key: string): Promise<ToolSnapshot | null>;
  /** Inserts or updates by key. */
  save(tool: ToolSnapshot): Promise<void>;
}

export type ToolCallStatus = 'ok' | 'error' | 'skipped';

/** One row of `tool_calls` (FR-23, FR-36). */
export interface ToolCallRecord {
  readonly id: string;
  readonly runId: string | null;
  readonly stepKey: string | null;
  readonly attemptN: number | null;
  readonly reused: boolean;
  readonly businessId: string;
  readonly toolKey: string;
  readonly inputHash: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly units: number;
  readonly millicredits: number;
  readonly providerCostMicros: number;
  readonly status: ToolCallStatus;
  readonly error: string | null;
  readonly durationMs: number;
  readonly createdAt: Date;
}

export interface ToolCallRepository {
  add(records: readonly ToolCallRecord[]): Promise<void>;
  /** The first stored `ok`, not reused call of this run, Step, Tool and input (FR-36). */
  findReusable(q: {
    runId: string;
    stepKey: string | null;
    toolKey: string;
    inputHash: string;
  }): Promise<ToolCallRecord | null>;
  /** Per Tool key, ok + error calls since `since` (reused and skipped excluded). */
  statsSince(since: Date): Promise<Map<string, ToolStats>>;
  /** A run's Tool calls, oldest first (Staff run detail). */
  listForRun(runId: string): Promise<ToolCallRecord[]>;
}

interface ApiKey {
  readonly apiKey: string | null;
}

/** Provider credentials as platform's SettingsReader returns them. */
export interface ProviderCredentials {
  readonly apify: ApiKey;
  readonly googleMaps: ApiKey;
  readonly firecrawl: ApiKey;
  readonly apollo: ApiKey;
  readonly hunter: ApiKey;
  readonly zerobounce: ApiKey;
  readonly twilio: { readonly accountSid: string | null; readonly authToken: string | null };
}

/** platform's SettingsReader, the parts the Tools read (ADR 0012). */
export interface ProviderSettings {
  ai(): Promise<{ readonly anthropicApiKey: string | null }>;
  provider<K extends keyof ProviderCredentials>(key: K): Promise<ProviderCredentials[K]>;
}

/** Whether a Tool's credentials are present in Platform settings. */
export async function isConfigured(
  requirement: ProviderRequirement,
  settings: ProviderSettings,
): Promise<boolean> {
  switch (requirement) {
    case null:
      return true;
    case 'anthropic':
      return Boolean((await settings.ai()).anthropicApiKey);
    case 'twilio': {
      const twilio = await settings.provider('twilio');
      return Boolean(twilio.accountSid && twilio.authToken);
    }
    default:
      return Boolean((await settings.provider(requirement)).apiKey);
  }
}

/** Waits between retries (a fake in tests so they run instantly). */
export interface Sleeper {
  sleep(ms: number): Promise<void>;
}

export const realSleeper: Sleeper = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
