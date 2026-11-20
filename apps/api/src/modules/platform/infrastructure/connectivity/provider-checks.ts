import type { ConnectivityCheck, ConnectivityResult } from '../../application/ports.js';
import type { ProviderCredentials, SettingsReader } from '../../application/settings-reader.js';

export type Fetch = typeof fetch;
type ApiKeyProvider = 'apify' | 'googleMaps' | 'firecrawl' | 'apollo' | 'hunter' | 'zerobounce';

interface Probe {
  readonly url: string;
  readonly headers?: Record<string, string>;
}

interface ProviderSpec<K extends keyof ProviderCredentials> {
  readonly name: string;
  /** null when the credentials are missing. */
  probe(credentials: ProviderCredentials[K]): Probe | null;
  /** Reads the provider's answer; only provider-authored messages, never the request or key. */
  interpret(status: number, body: unknown): ConnectivityResult;
}

const NOT_CONFIGURED: ConnectivityResult = {
  ok: false,
  message: 'Not configured: save the credentials first',
};

function field(body: unknown, ...path: string[]): unknown {
  let node = body;
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

function providerMessage(body: unknown): string | null {
  const candidates = [
    field(body, 'error', 'message'),
    field(body, 'error_message'),
    field(body, 'error'),
    field(body, 'message'),
    field(body, 'errors', '0', 'details'),
    field(body, 'errors'),
  ];
  const found = candidates.find((c) => typeof c === 'string' && c.trim() !== '');
  return typeof found === 'string' ? found.slice(0, 300) : null;
}

/** 2xx means connected; anything else shows the provider's message (or the HTTP status). */
function byStatus(status: number, body: unknown): ConnectivityResult {
  if (status >= 200 && status < 300) return { ok: true, message: 'Connected' };
  return { ok: false, message: providerMessage(body) ?? `The provider answered HTTP ${status}` };
}

const apiKey =
  (build: (key: string) => Probe) =>
  (credentials: { apiKey: string | null }): Probe | null =>
    credentials.apiKey ? build(credentials.apiKey) : null;

/** The cheapest status call each provider allows (FR-8). */
export const PROVIDER_SPECS: {
  readonly [K in ApiKeyProvider]: ProviderSpec<K>;
} & { readonly twilio: ProviderSpec<'twilio'> } = {
  apify: {
    name: 'Apify',
    probe: apiKey((key) => ({
      url: 'https://api.apify.com/v2/users/me',
      headers: { Authorization: `Bearer ${key}` },
    })),
    interpret: byStatus,
  },
  googleMaps: {
    name: 'Google Maps Platform',
    // Geocoding takes the key only as a query parameter; the URL is never shown or logged.
    probe: apiKey((key) => ({
      url: `https://maps.googleapis.com/maps/api/geocode/json?address=Austin%2C%20TX&key=${encodeURIComponent(key)}`,
    })),
    interpret: (status, body) => {
      const result = field(body, 'status');
      if (status === 200 && (result === 'OK' || result === 'ZERO_RESULTS')) {
        return { ok: true, message: 'Connected' };
      }
      return {
        ok: false,
        message:
          providerMessage(body) ??
          (typeof result === 'string' ? result : `The provider answered HTTP ${status}`),
      };
    },
  },
  firecrawl: {
    name: 'Firecrawl',
    probe: apiKey((key) => ({
      url: 'https://api.firecrawl.dev/v1/team/credit-usage',
      headers: { Authorization: `Bearer ${key}` },
    })),
    interpret: byStatus,
  },
  apollo: {
    name: 'Apollo',
    probe: apiKey((key) => ({
      url: 'https://api.apollo.io/v1/auth/health',
      headers: { 'X-Api-Key': key },
    })),
    interpret: (status, body) => {
      if (status === 200 && field(body, 'is_logged_in') === false) {
        return { ok: false, message: 'The API key was not accepted' };
      }
      return byStatus(status, body);
    },
  },
  hunter: {
    name: 'Hunter',
    probe: apiKey((key) => ({
      url: 'https://api.hunter.io/v2/account',
      headers: { 'X-API-KEY': key },
    })),
    interpret: byStatus,
  },
  zerobounce: {
    name: 'ZeroBounce',
    probe: apiKey((key) => ({
      url: `https://api.zerobounce.net/v2/getcredits?api_key=${encodeURIComponent(key)}`,
    })),
    interpret: (status, body) => {
      const credits = Number(field(body, 'Credits'));
      if (status === 200 && credits >= 0) return { ok: true, message: `Connected (${credits} credits)` };
      if (status === 200) return { ok: false, message: 'The API key was not accepted' };
      return byStatus(status, body);
    },
  },
  twilio: {
    name: 'Twilio',
    probe: ({ accountSid, authToken }) =>
      accountSid && authToken
        ? {
            url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`,
            headers: {
              Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
            },
          }
        : null,
    interpret: byStatus,
  },
};

export function providerCheck<K extends keyof typeof PROVIDER_SPECS>(
  key: K,
  deps: { settings: SettingsReader; fetch?: Fetch },
): ConnectivityCheck {
  const spec = PROVIDER_SPECS[key] as unknown as ProviderSpec<K>;
  return async ({ signal }) => {
    const credentials = await deps.settings.provider(key);
    const probe = spec.probe(credentials);
    if (!probe) return NOT_CONFIGURED;
    let response: Response;
    try {
      response = await (deps.fetch ?? fetch)(probe.url, { headers: probe.headers ?? {}, signal });
    } catch {
      // Network errors can echo the URL (which may carry the key), so the message is fixed.
      return {
        ok: false,
        message: signal.aborted ? 'Timed out' : `Could not reach ${spec.name}`,
      };
    }
    const body: unknown = await response.json().catch(() => null);
    return withoutSecrets(spec.interpret(response.status, body), Object.values(credentials));
  };
}

/** A provider message never repeats a credential back to the browser. */
export function withoutSecrets(
  result: ConnectivityResult,
  secrets: readonly (string | null)[],
): ConnectivityResult {
  let message = result.message;
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('****');
  }
  return { ...result, message };
}
