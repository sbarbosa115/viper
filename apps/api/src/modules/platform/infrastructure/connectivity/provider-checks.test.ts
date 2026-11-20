import { describe, expect, test } from 'vitest';
import { fakeSettingsReader } from '../../test/fakes.js';
import { providerCheck, PROVIDER_SPECS, type Fetch } from './provider-checks.js';

interface Call {
  url: string;
  headers: Record<string, string>;
}

function fakeFetch(status: number, body: unknown, calls: Call[] = []): Fetch {
  return ((url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as Fetch;
}

const signal = new AbortController().signal;
const KEY = 'live-key-0123456789';

const configured = fakeSettingsReader({
  'providers.apify.apiKey': KEY,
  'providers.googleMaps.apiKey': KEY,
  'providers.firecrawl.apiKey': KEY,
  'providers.apollo.apiKey': KEY,
  'providers.hunter.apiKey': KEY,
  'providers.zerobounce.apiKey': KEY,
  'providers.twilio.accountSid': 'AC123',
  'providers.twilio.authToken': KEY,
});

const okBodies: Record<keyof typeof PROVIDER_SPECS, unknown> = {
  apify: { data: { id: 'u1' } },
  googleMaps: { status: 'OK', results: [] },
  firecrawl: { success: true },
  apollo: { is_logged_in: true },
  hunter: { data: { calls: {} } },
  zerobounce: { Credits: '2500' },
  twilio: { sid: 'AC123', status: 'active' },
};
const providers = Object.keys(PROVIDER_SPECS) as (keyof typeof PROVIDER_SPECS)[];

describe('FR-8: provider "Test" actions', () => {
  test.each(providers)('%s: connected when the provider accepts the key', async (provider) => {
    const calls: Call[] = [];
    const check = providerCheck(provider, {
      settings: configured,
      fetch: fakeFetch(200, okBodies[provider], calls),
    });
    const result = await check({ signal });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/^Connected/);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.startsWith('https://')).toBe(true);
  });

  test.each(providers)('%s: not configured without credentials (no request)', async (provider) => {
    const calls: Call[] = [];
    const check = providerCheck(provider, {
      settings: fakeSettingsReader(),
      fetch: fakeFetch(200, {}, calls),
    });
    expect(await check({ signal })).toEqual({
      ok: false,
      message: 'Not configured: save the credentials first',
    });
    expect(calls).toHaveLength(0);
  });

  test.each(providers)(
    '%s: a rejected key shows the provider message, never the key',
    async (provider) => {
      const check = providerCheck(provider, {
        settings: configured,
        fetch: fakeFetch(401, {
          error: { message: `Invalid key ${KEY}` },
          message: `Invalid key ${KEY}`,
        }),
      });
      const result = await check({ signal });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Invalid key');
      expect(result.message).not.toContain(KEY);
    },
  );

  test('a header-authenticated provider sends the key in a header, not the URL', async () => {
    const calls: Call[] = [];
    await providerCheck('apollo', {
      settings: configured,
      fetch: fakeFetch(200, okBodies.apollo, calls),
    })({
      signal,
    });
    expect(calls[0]?.url).not.toContain(KEY);
    expect(calls[0]?.headers['X-Api-Key']).toBe(KEY);
  });

  test("Google Maps REQUEST_DENIED (HTTP 200) is a failure with Google's message", async () => {
    const check = providerCheck('googleMaps', {
      settings: configured,
      fetch: fakeFetch(200, {
        status: 'REQUEST_DENIED',
        error_message: 'The provided API key is invalid.',
      }),
    });
    expect(await check({ signal })).toEqual({
      ok: false,
      message: 'The provided API key is invalid.',
    });
  });

  test('ZeroBounce answers Credits -1 for an invalid key', async () => {
    const check = providerCheck('zerobounce', {
      settings: configured,
      fetch: fakeFetch(200, { Credits: '-1' }),
    });
    expect(await check({ signal })).toEqual({ ok: false, message: 'The API key was not accepted' });
  });

  test('a network error never echoes the request URL (which may hold the key)', async () => {
    const failing = (() => Promise.reject(new TypeError(`fetch failed for ?key=${KEY}`))) as Fetch;
    const result = await providerCheck('googleMaps', { settings: configured, fetch: failing })({
      signal,
    });
    expect(result).toEqual({ ok: false, message: 'Could not reach Google Maps Platform' });
  });
});
