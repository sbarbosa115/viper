import { describe, expect, test } from 'vitest';
import * as ex from './examples.js';
import {
  getPublicConfig,
  getSettings,
  listAuditLog,
  testSettings,
  updateSettings,
} from './platform.js';

describe('contracts: platform', () => {
  test('FR-9: public config', () => {
    const config = { gaMeasurementId: 'G-ABC123', supportEmail: null, youtubeVideoId: null };
    expect(getPublicConfig.response.safeParse(config).success).toBe(true);
    expect(getPublicConfig.response.safeParse({ ...config, gaMeasurementId: 'UA-1' }).success).toBe(
      false,
    );
    expect(getPublicConfig.response.safeParse({ ...config, youtubeVideoId: 'short' }).success).toBe(
      false,
    );
  });

  test('FR-8: settings expose secrets only as { set, last4, updatedAt }', () => {
    expect(getSettings.response.parse(ex.platformSettings)).toEqual(ex.platformSettings);
    const leaked = {
      ...ex.platformSettings,
      ai: { ...ex.platformSettings.ai, anthropicApiKey: 'sk-ant-secret' },
    };
    expect(getSettings.response.safeParse(leaked).success).toBe(false);
  });

  test('FR-8: a section save takes secrets as string, "" or omitted', () => {
    const ai = {
      planningModel: 'claude-opus-5-5',
      chatModel: 'claude-sonnet-5-5',
      fastModel: 'claude-haiku-5-5',
    };
    expect(updateSettings.ai.body.safeParse(ai).success).toBe(true);
    expect(updateSettings.ai.body.safeParse({ ...ai, anthropicApiKey: '' }).success).toBe(true);
    expect(
      updateSettings.ai.body.safeParse({ ...ai, anthropicApiKey: { set: true } }).success,
    ).toBe(false);
    expect(updateSettings.ai.path).toBe('/api/staff/settings/ai');
    expect(updateSettings.ai.response.safeParse(ex.platformSettings.ai).success).toBe(true);
  });

  test('FR-8: invalid measurement ID and ceilings are rejected', () => {
    expect(updateSettings.analytics.body.safeParse({ gaMeasurementId: 'G-AB' }).success).toBe(
      false,
    );
    expect(updateSettings.analytics.body.safeParse({ gaMeasurementId: null }).success).toBe(true);
    expect(updateSettings.ceilings.body.safeParse(ex.platformSettings.ceilings).success).toBe(true);
    expect(
      updateSettings.ceilings.body.safeParse({ ...ex.platformSettings.ceilings, maxAttempts: 0 })
        .success,
    ).toBe(false);
  });

  test('FR-8: email and providers sections', () => {
    const email = { ...ex.platformSettings.email, password: 'smtp-pass' };
    expect(updateSettings.email.body.safeParse(email).success).toBe(true);
    expect(updateSettings.email.body.safeParse({ ...email, tls: 'ssl' }).success).toBe(false);
    const providers = {
      apify: { apiKey: 'x' },
      googleMaps: {},
      firecrawl: {},
      apollo: {},
      hunter: {},
      zerobounce: {},
      twilio: { accountSid: 'AC1', authToken: 't' },
    };
    expect(updateSettings.providers.body.safeParse(providers).success).toBe(true);
    expect(
      updateSettings.providers.body.safeParse({ ...providers, twilio: undefined }).success,
    ).toBe(false);
  });

  test('FR-8: the SMTP test needs an address', () => {
    expect(testSettings.body.safeParse({ target: 'anthropic' }).success).toBe(true);
    expect(testSettings.body.safeParse({ target: 'smtp', to: 'me@demo.test' }).success).toBe(true);
    const missing = testSettings.body.safeParse({ target: 'smtp' });
    expect(missing.error?.issues[0]?.path).toEqual(['to']);
    expect(testSettings.response.safeParse({ ok: false, message: 'Timed out' }).success).toBe(true);
  });

  test('FR-7: audit log list defaults to 50 and filters', () => {
    expect(listAuditLog.query.parse({}).limit).toBe(50);
    expect(listAuditLog.query.safeParse({ businessId: 'x' }).success).toBe(false);
    const pageOk = { items: [ex.auditLogEntry], nextCursor: null };
    expect(listAuditLog.response.safeParse(pageOk).success).toBe(true);
    expect(listAuditLog.response.safeParse({ items: [ex.auditLogEntry] }).success).toBe(false);
  });
});
