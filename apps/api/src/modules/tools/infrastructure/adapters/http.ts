import { ToolFailure } from '../../application/tool-adapter.js';

export type Fetch = typeof fetch;

/** Provider calls give up after 30 s (a timeout is retryable). */
export const PROVIDER_TIMEOUT_MS = 30_000;

function field(body: unknown, ...path: string[]): unknown {
  let node = body;
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** The provider's own message from an error body (never the request, which may hold the key). */
export function providerMessage(body: unknown): string | null {
  const candidates = [
    field(body, 'error', 'message'),
    field(body, 'error_message'),
    field(body, 'error'),
    field(body, 'message'),
    field(body, 'details'),
  ];
  const found = candidates.find((c) => typeof c === 'string' && c.trim() !== '');
  return typeof found === 'string' ? found.slice(0, 300) : null;
}

/** Maps an HTTP status to a ToolFailure: 429/5xx retryable, 401/403 not configured, else final. */
export function failureFor(provider: string, status: number, body: unknown): ToolFailure {
  const message = `${provider} answered HTTP ${status}${providerMessage(body) ? `: ${providerMessage(body)}` : ''}`;
  if (status === 401 || status === 403) return ToolFailure.notConfigured(message);
  if (status === 408 || status === 429 || status >= 500) return ToolFailure.retryable(message);
  return ToolFailure.final(message);
}

/**
 * Calls a provider JSON API. Network failures and timeouts become retryable failures; non-2xx
 * statuses become failures by `failureFor`. Error messages never contain the URL (keys may be in
 * the query string).
 */
export async function requestJson(
  fetchFn: Fetch,
  provider: string,
  url: string,
  init: RequestInit = {},
  timeoutMs = PROVIDER_TIMEOUT_MS,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw ToolFailure.retryable(`${provider} ${timedOut ? 'timed out' : 'could not be reached'}`);
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    if (response.ok)
      throw ToolFailure.retryable(`${provider} returned a response that is not JSON`);
  }
  if (!response.ok) throw failureFor(provider, response.status, body);
  return body;
}

/** Throws a not-configured failure when a key is missing (the runner checks first; belt and braces). */
export function requireKey<T>(value: T | null | undefined, provider: string): T {
  if (value === null || value === undefined || value === '') {
    throw ToolFailure.notConfigured(`${provider} is not configured in Platform settings`);
  }
  return value;
}
