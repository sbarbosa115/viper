import { Writable } from 'node:stream';
import { errorResponse } from '@app/contracts/errors';
import {
  getPublicConfig,
  getSettings,
  listAuditLog,
  settingsSections,
  testSettings,
} from '@app/contracts/platform';
import { pino } from 'pino';
import { describe, expect, test } from 'vitest';
import { buildTestApp } from '../../../../test/build-test-app.js';
import type { Actor } from '../../../shared/domain/actor.js';
import { createPlatformModule } from '../index.js';
import {
  FakeAuditDirectory,
  fakeConnectivityTester,
  ids,
  ownerActor,
  platformRouteFakes,
  staffActor,
} from '../test/fakes.js';

async function appWith(actor?: Actor, fakes = platformRouteFakes()) {
  const app = await buildTestApp({
    modules: [createPlatformModule(fakes.routes)],
    ...(actor ? { actor } : {}),
  });
  return { app, fakes };
}

const aiBody = {
  anthropicApiKey: 'sk-ant-api03-SECRET-a1f3',
  planningModel: 'claude-opus-5-5',
  chatModel: 'claude-sonnet-5-5',
  fastModel: 'claude-haiku-5-5',
};

describe('FR-9: GET /api/public/config', () => {
  test('is public and parses against the contract', async () => {
    const { app } = await appWith();
    const res = await app.inject({ method: 'GET', url: '/api/public/config' });
    expect(res.statusCode).toBe(200);
    expect(getPublicConfig.response.parse(res.json())).toEqual({
      gaMeasurementId: null,
      supportEmail: null,
      youtubeVideoId: null,
    });
  });

  test('returns the saved measurement ID, no secrets, cached briefly', async () => {
    const fakes = platformRouteFakes();
    const { app: staff } = await appWith(staffActor(), fakes);
    await staff.inject({ method: 'PUT', url: '/api/staff/settings/ai', payload: aiBody });
    await staff.inject({
      method: 'PUT',
      url: '/api/staff/settings/analytics',
      payload: { gaMeasurementId: 'G-ABC1234' },
    });
    const { app } = await appWith(undefined, fakes);
    const res = await app.inject({ method: 'GET', url: '/api/public/config' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(Object.keys(res.json()).sort()).toEqual([
      'gaMeasurementId',
      'supportEmail',
      'youtubeVideoId',
    ]);
    expect(res.json()).toMatchObject({ gaMeasurementId: 'G-ABC1234' });
    expect(res.body).not.toContain('SECRET');
  });
});

describe('FR-8: GET /api/staff/settings', () => {
  test('Staff get every section', async () => {
    const { app } = await appWith(staffActor());
    const res = await app.inject({ method: 'GET', url: '/api/staff/settings' });
    expect(res.statusCode).toBe(200);
    const body = getSettings.response.parse(res.json());
    expect(body.ai.planningModel).toBe('claude-opus-5-5');
    expect(body.email.fromName).toBe('Llyner Leads');
  });

  test('a non-Staff Member gets 403', async () => {
    const { app } = await appWith(ownerActor());
    const res = await app.inject({ method: 'GET', url: '/api/staff/settings' });
    expect(res.statusCode).toBe(403);
    expect(errorResponse.parse(res.json()).error.code).toBe('FORBIDDEN');
  });

  test('Staff without two-factor (no staff role) get 403', async () => {
    const { app } = await appWith(ownerActor({ memberId: ids.staff }));
    expect((await app.inject({ method: 'GET', url: '/api/staff/settings' })).statusCode).toBe(403);
  });

  test('not signed in gets 401', async () => {
    const { app } = await appWith();
    const res = await app.inject({ method: 'GET', url: '/api/staff/settings' });
    expect(res.statusCode).toBe(401);
  });
});

describe('FR-8: PUT /api/staff/settings/:section', () => {
  test('saving a secret returns only last4; reloading too', async () => {
    const { app } = await appWith(staffActor());
    const res = await app.inject({ method: 'PUT', url: '/api/staff/settings/ai', payload: aiBody });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('SECRET');
    const section = settingsSections.ai.parse(res.json());
    expect(section.anthropicApiKey).toMatchObject({ set: true, last4: 'a1f3' });
    const reload = await app.inject({ method: 'GET', url: '/api/staff/settings' });
    expect(reload.body).not.toContain('SECRET');
    expect(getSettings.response.parse(reload.json()).ai.anthropicApiKey.last4).toBe('a1f3');
  });

  test('FR-7: the save writes settings.ai.updated with field names, no key value', async () => {
    const { app, fakes } = await appWith(staffActor());
    await app.inject({ method: 'PUT', url: '/api/staff/settings/ai', payload: aiBody });
    expect(fakes.uow.auditLog.entries).toHaveLength(1);
    expect(fakes.uow.auditLog.entries[0]).toMatchObject({
      action: 'settings.ai.updated',
      details: { fields: ['anthropicApiKey'] },
    });
    expect(JSON.stringify(fakes.uow.auditLog.entries)).not.toContain('SECRET');
  });

  test('NFR-4: secrets never reach the logs', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const fakes = platformRouteFakes();
    const app = await buildTestApp({
      modules: [createPlatformModule(fakes.routes)],
      actor: staffActor(),
      deps: { logger: pino({ level: 'trace' }, stream) },
    });
    await app.inject({ method: 'PUT', url: '/api/staff/settings/ai', payload: aiBody });
    await app.inject({
      method: 'PUT',
      url: '/api/staff/settings/email',
      payload: { ...settingsBody.email, password: 'smtp-SECRET-pass' },
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('SECRET');
  });

  test('an invalid GA measurement ID is 400 naming the field', async () => {
    const { app } = await appWith(staffActor());
    const res = await app.inject({
      method: 'PUT',
      url: '/api/staff/settings/analytics',
      payload: { gaMeasurementId: 'UA-12345' },
    });
    expect(res.statusCode).toBe(400);
    const body = errorResponse.parse(res.json());
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(body.error.fields ?? {})).toContain('gaMeasurementId');
  });

  test('a YouTube video ID must have 11 characters', async () => {
    const { app } = await appWith(staffActor());
    const bad = await app.inject({
      method: 'PUT',
      url: '/api/staff/settings/landing',
      payload: { youtubeVideoId: 'short' },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'PUT',
      url: '/api/staff/settings/landing',
      payload: { youtubeVideoId: 'dQw4w9WgXcQ' },
    });
    expect(ok.statusCode).toBe(200);
    const config = await app.inject({ method: 'GET', url: '/api/public/config' });
    expect(config.json()).toMatchObject({ youtubeVideoId: 'dQw4w9WgXcQ' });
  });

  test('ceilings are validated (e.g. max attempts 1..10)', async () => {
    const { app } = await appWith(staffActor());
    const res = await app.inject({
      method: 'PUT',
      url: '/api/staff/settings/ceilings',
      payload: { ...settingsBody.ceilings, maxAttempts: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(errorResponse.parse(res.json()).error.fields).toHaveProperty('maxAttempts');
  });

  test.each(Object.keys(settingsSections))('section %s saves and parses', async (section) => {
    const { app } = await appWith(staffActor());
    const res = await app.inject({
      method: 'PUT',
      url: `/api/staff/settings/${section}`,
      payload: settingsBody[section as keyof typeof settingsBody],
    });
    expect(res.statusCode).toBe(200);
    settingsSections[section as keyof typeof settingsSections].parse(res.json());
  });

  test('an unknown section is 404', async () => {
    const { app } = await appWith(staffActor());
    const res = await app.inject({ method: 'PUT', url: '/api/staff/settings/nope', payload: {} });
    expect(res.statusCode).toBe(404);
  });

  test('a non-Staff Member cannot save (403)', async () => {
    const { app } = await appWith(ownerActor());
    const res = await app.inject({ method: 'PUT', url: '/api/staff/settings/ai', payload: aiBody });
    expect(res.statusCode).toBe(403);
  });
});

describe('FR-8: POST /api/staff/settings/test', () => {
  test('runs the check for the target', async () => {
    const tester = fakeConnectivityTester();
    const { app } = await appWith(staffActor(), platformRouteFakes({ tester }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/staff/settings/test',
      payload: { target: 'smtp', to: 'Ops@Llyner.test' },
    });
    expect(res.statusCode).toBe(200);
    expect(testSettings.response.parse(res.json())).toEqual({ ok: true, message: 'Connected' });
    expect(tester.calls).toEqual([{ target: 'smtp', to: 'ops@llyner.test' }]);
  });

  test('smtp without an address is 400', async () => {
    const { app } = await appWith(staffActor());
    const res = await app.inject({
      method: 'POST',
      url: '/api/staff/settings/test',
      payload: { target: 'smtp' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('an unknown target is 400', async () => {
    const { app } = await appWith(staffActor());
    const res = await app.inject({
      method: 'POST',
      url: '/api/staff/settings/test',
      payload: { target: 'openai' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('a failing provider is 200 { ok: false } with its message', async () => {
    const tester = fakeConnectivityTester({
      anthropic: () => Promise.resolve({ ok: false, message: 'model: claude-nope' }),
    });
    const { app } = await appWith(staffActor(), platformRouteFakes({ tester }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/staff/settings/test',
      payload: { target: 'anthropic' },
    });
    expect(res.json()).toEqual({ ok: false, message: 'model: claude-nope' });
  });
});

describe('FR-7: GET /api/staff/audit-log', () => {
  test('lists entries newest first with names, 50 per page by default', async () => {
    const directory = new FakeAuditDirectory(
      new Map([[ids.staff, { email: 'staff@demo.test' }]]),
      new Map(),
    );
    const fakes = platformRouteFakes({ directory });
    const { app } = await appWith(staffActor(), fakes);
    for (let i = 0; i < 52; i += 1) {
      fakes.clock.set(new Date(Date.UTC(2026, 10, 19, 10, 0, i)));
      await app.inject({
        method: 'PUT',
        url: '/api/staff/settings/landing',
        payload: { youtubeVideoId: null },
      });
    }
    const first = await app.inject({ method: 'GET', url: '/api/staff/audit-log' });
    expect(first.statusCode).toBe(200);
    const page = listAuditLog.response.parse(first.json());
    expect(page.items).toHaveLength(50);
    expect(page.items[0]?.staff).toEqual({ id: ids.staff, email: 'staff@demo.test' });
    expect(page.items[0]?.at).toBe('2026-11-19T10:00:51.000Z');
    expect(page.nextCursor).not.toBeNull();
    const second = await app.inject({
      method: 'GET',
      url: `/api/staff/audit-log?cursor=${encodeURIComponent(page.nextCursor ?? '')}`,
    });
    expect(listAuditLog.response.parse(second.json()).items).toHaveLength(2);
  });

  test('filters by action', async () => {
    const { app } = await appWith(staffActor());
    await app.inject({ method: 'PUT', url: '/api/staff/settings/ai', payload: aiBody });
    await app.inject({
      method: 'PUT',
      url: '/api/staff/settings/landing',
      payload: { youtubeVideoId: null },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/staff/audit-log?action=settings.ai.updated',
    });
    const page = listAuditLog.response.parse(res.json());
    expect(page.items.map((e) => e.action)).toEqual(['settings.ai.updated']);
  });

  test('a bad businessId filter is 400', async () => {
    const { app } = await appWith(staffActor());
    const res = await app.inject({ method: 'GET', url: '/api/staff/audit-log?businessId=nope' });
    expect(res.statusCode).toBe(400);
  });

  test('a non-Staff Member gets 403; Customers do not see the log', async () => {
    const { app } = await appWith(ownerActor());
    expect((await app.inject({ method: 'GET', url: '/api/staff/audit-log' })).statusCode).toBe(403);
  });
});

const settingsBody = {
  ai: aiBody,
  providers: {
    apify: { apiKey: 'apify_api_SECRET_0001' },
    googleMaps: {},
    firecrawl: {},
    apollo: {},
    hunter: {},
    zerobounce: {},
    twilio: { accountSid: 'AC123', authToken: 'twilio-SECRET-0001' },
  },
  email: {
    host: 'mailpit',
    port: 1025,
    username: null,
    tls: 'none',
    fromName: 'Llyner Leads',
    fromAddress: 'hello@llyner.test',
    replyTo: null,
  },
  stripe: { secretKey: 'sk_test_SECRET_0001', taxEnabled: true },
  analytics: { gaMeasurementId: 'G-ABC1234' },
  ceilings: {
    maxCredits: 1000,
    maxLeads: 500,
    maxActiveMinutes: 120,
    maxTotalHours: 4,
    maxAttempts: 5,
    trialCredits: 50,
  },
  landing: { youtubeVideoId: null },
  support: { supportEmail: 'help@llyner.test' },
};
