import { beforeEach, describe, expect, test } from 'vitest';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { emptySection } from '../domain/settings.js';
import { AesGcmSecretBox } from '../infrastructure/secret-box.js';
import { InMemorySettingsRepository } from '../test/fakes.js';
import { CachedSettingsReader } from './settings-reader.js';

const box = new AesGcmSecretBox(Buffer.alloc(32, 3));
const t0 = new Date('2026-11-19T10:00:00.000Z');

let repository: InMemorySettingsRepository;
let clock: FixedClock;
let reader: CachedSettingsReader;

function sealed(value: string, context: string) {
  return { ...box.encrypt(value, context), last4: value.slice(-4), updatedAt: t0 };
}

beforeEach(() => {
  repository = new InMemorySettingsRepository();
  clock = new FixedClock(t0);
  reader = new CachedSettingsReader({ repository, secretBox: box, clock });
});

describe('FR-8: SettingsReader', () => {
  test('defaults when nothing is saved', async () => {
    expect(await reader.ai()).toEqual({
      anthropicApiKey: null,
      planningModel: 'claude-opus-5-5',
      chatModel: 'claude-sonnet-5-5',
      fastModel: 'claude-haiku-5-5',
    });
    expect(await reader.ceilings()).toEqual({
      maxCredits: 1000,
      maxLeads: 500,
      maxActiveMinutes: 120,
      maxTotalHours: 4,
      maxAttempts: 5,
      trialCredits: 50,
    });
    expect(await reader.provider('twilio')).toEqual({ accountSid: null, authToken: null });
    expect((await reader.stripe()).taxEnabled).toBe(true);
  });

  test('decrypts secrets for server use', async () => {
    await repository.save({
      ...emptySection('providers'),
      values: { twilio: { accountSid: 'AC42' } },
      secrets: {
        'apify.apiKey': sealed('apify_api_key_1', 'providers.apify.apiKey'),
        'twilio.authToken': sealed('twilio-token-1', 'providers.twilio.authToken'),
      },
    });
    expect(await reader.provider('apify')).toEqual({ apiKey: 'apify_api_key_1' });
    expect(await reader.provider('twilio')).toEqual({
      accountSid: 'AC42',
      authToken: 'twilio-token-1',
    });
    expect(await reader.provider('hunter')).toEqual({ apiKey: null });
  });

  test('changes take effect within 60 s (cached at most 60 s)', async () => {
    await reader.support();
    await repository.save({ ...emptySection('support'), values: { supportEmail: 'a@b.test' } });
    clock.set(new Date(t0.getTime() + 59_999));
    expect((await reader.support()).supportEmail).toBeNull();
    clock.set(new Date(t0.getTime() + 60_000));
    expect((await reader.support()).supportEmail).toBe('a@b.test');
  });

  test('reads all sections once per cache period', async () => {
    await Promise.all([reader.ai(), reader.email(), reader.landing()]);
    await reader.analytics();
    expect(repository.reads).toBe(1);
  });

  test('a secret sealed under another key reads as not set', async () => {
    const other = new AesGcmSecretBox(Buffer.alloc(32, 9));
    await repository.save({
      ...emptySection('ai'),
      secrets: {
        anthropicApiKey: {
          ...other.encrypt('sk-ant-old', 'ai.anthropicApiKey'),
          last4: null,
          updatedAt: t0,
        },
      },
    });
    expect((await reader.ai()).anthropicApiKey).toBeNull();
  });
});
