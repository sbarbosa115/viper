import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { InMemoryEmailSender } from '../../../../shared/infrastructure/email/in-memory-email-sender.js';
import { fakeSettingsReader } from '../../test/fakes.js';
import { anthropicCheck, smtpCheck, stripeCheck, TEST_EMAIL_SUBJECT } from './service-checks.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let server: Server | null = null;

async function localApi(handler: Handler): Promise<number> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const signal = () => new AbortController().signal;

describe('FR-8: Anthropic "Test" action (local fake API, never the real one)', () => {
  const seen: { url: string; key: string | undefined }[] = [];
  const anthropicApi: Handler = (req, res) => {
    seen.push({ url: req.url ?? '', key: req.headers.authorization });
    if (req.url?.endsWith('/claude-nope')) {
      json(res, 404, {
        type: 'error',
        error: { type: 'not_found_error', message: 'model: claude-nope' },
      });
      return;
    }
    json(res, 200, { type: 'model', id: req.url?.split('/').pop(), display_name: 'x' });
  };

  test('checks the key against every configured model', async () => {
    seen.length = 0;
    const port = await localApi(anthropicApi);
    const check = anthropicCheck({
      settings: fakeSettingsReader({ 'ai.anthropicApiKey': 'sk-ant-test-key-1' }),
      baseURL: `http://127.0.0.1:${port}`,
    });
    const result = await check({ signal: signal() });
    expect(result).toEqual({
      ok: true,
      message: 'Connected. Models available: claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5',
    });
    expect(seen.map((s) => s.url)).toEqual([
      '/v1/models/claude-opus-5-5',
      '/v1/models/claude-sonnet-5-5',
      '/v1/models/claude-haiku-5-5',
    ]);
    expect(seen[0]?.key).toBe('Bearer sk-ant-test-key-1');
  });

  test('a model ID Anthropic rejects shows the provider message', async () => {
    const port = await localApi(anthropicApi);
    const check = anthropicCheck({
      settings: fakeSettingsReader({
        'ai.anthropicApiKey': 'sk-ant-test-key-1',
        'ai.fastModel': 'claude-nope',
      }),
      baseURL: `http://127.0.0.1:${port}`,
    });
    expect(await check({ signal: signal() })).toEqual({ ok: false, message: 'model: claude-nope' });
  });

  test('without a key it is not configured', async () => {
    expect(await anthropicCheck({ settings: fakeSettingsReader() })({ signal: signal() })).toEqual({
      ok: false,
      message: 'Not configured: save the Anthropic API key first',
    });
  });
});

describe('FR-8: Stripe "Test" action (local fake API)', () => {
  test('retrieves the balance', async () => {
    let auth = '';
    const port = await localApi((req, res) => {
      auth = String(req.headers.authorization);
      json(res, 200, { object: 'balance', livemode: false, available: [], pending: [] });
    });
    const check = stripeCheck({
      settings: fakeSettingsReader({ 'stripe.secretKey': 'sk_test_abcdef123456' }),
      endpoint: { host: '127.0.0.1', port, protocol: 'http' },
    });
    expect(await check({ signal: signal() })).toEqual({
      ok: true,
      message: 'Connected (test mode)',
    });
    expect(auth).toBe('Bearer sk_test_abcdef123456');
  });

  test("a rejected key shows Stripe's message without the key", async () => {
    const port = await localApi((_req, res) => {
      json(res, 401, {
        error: {
          type: 'invalid_request_error',
          message: 'Invalid API Key provided: sk_test_abcdef123456',
        },
      });
    });
    const check = stripeCheck({
      settings: fakeSettingsReader({ 'stripe.secretKey': 'sk_test_abcdef123456' }),
      endpoint: { host: '127.0.0.1', port, protocol: 'http' },
    });
    const result = await check({ signal: signal() });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Invalid API Key provided');
    expect(result.message).not.toContain('sk_test_abcdef123456');
  });
});

describe('FR-8: SMTP "Send test email"', () => {
  const smtpSettings = {
    'email.host': 'mailpit',
    'email.fromAddress': 'hello@llyner.test',
    'email.password': 'smtp-pass-1234',
  };

  test('sends "Test email from Llyner Leads" to the given address', async () => {
    const email = new InMemoryEmailSender();
    const result = await smtpCheck({ settings: fakeSettingsReader(smtpSettings), email })({
      to: 'ops@llyner.test',
      signal: signal(),
    });
    expect(result).toEqual({ ok: true, message: 'Test email sent to ops@llyner.test' });
    expect(email.sent).toEqual([
      expect.objectContaining({ to: 'ops@llyner.test', subject: TEST_EMAIL_SUBJECT }),
    ]);
  });

  test('a send failure is shown without the password', async () => {
    const email = {
      send: () => Promise.reject(new Error('535 auth failed for smtp-pass-1234')),
    };
    const result = await smtpCheck({ settings: fakeSettingsReader(smtpSettings), email })({
      to: 'ops@llyner.test',
      signal: signal(),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('535 auth failed');
    expect(result.message).not.toContain('smtp-pass-1234');
  });

  test('without a host it is not configured', async () => {
    const email = new InMemoryEmailSender();
    const result = await smtpCheck({ settings: fakeSettingsReader(), email })({
      to: 'ops@llyner.test',
      signal: signal(),
    });
    expect(result.ok).toBe(false);
    expect(email.sent).toHaveLength(0);
  });
});
