import { platformSettings, settingsSections } from '@app/contracts/platform';
import { beforeEach, describe, expect, test } from 'vitest';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import { AesGcmSecretBox } from '../infrastructure/secret-box.js';
import {
  InMemorySettingsUnitOfWork,
  fakeConnectivityTester,
  ownerActor,
  staffActor,
} from '../test/fakes.js';
import { CachedSettingsReader } from './settings-reader.js';
import {
  GetPublicConfig,
  GetSettings,
  TestSettings,
  UpdateSettingsSection,
} from './settings-use-cases.js';

const box = new AesGcmSecretBox(Buffer.alloc(32, 7));
const aiBase = {
  planningModel: 'claude-opus-5-5',
  chatModel: 'claude-sonnet-5-5',
  fastModel: 'claude-haiku-5-5',
};

function setup() {
  const clock = new FixedClock(new Date('2026-11-19T10:00:00.000Z'));
  const uow = new InMemorySettingsUnitOfWork();
  const reader = new CachedSettingsReader({ repository: uow.settings, secretBox: box, clock });
  const update = new UpdateSettingsSection({
    uow,
    secretBox: box,
    reader,
    clock,
    ids: new SequentialIdGenerator(),
  });
  const get = new GetSettings({ repository: uow.settings });
  return { clock, uow, reader, update, get };
}

let ctx: ReturnType<typeof setup>;
beforeEach(() => {
  ctx = setup();
});

describe('FR-8: get platform settings', () => {
  test('returns every section with defaults and masked secrets', async () => {
    const settings = await ctx.get.execute({ actor: staffActor() });
    expect(platformSettings.parse(settings)).toEqual(settings);
    expect(settings.ai).toEqual({
      ...aiBase,
      anthropicApiKey: { set: false, last4: null, updatedAt: null },
    });
    expect(settings.email.port).toBe(2525);
    expect(settings.ceilings.trialCredits).toBe(50);
  });

  test('a non-Staff Member gets 403 FORBIDDEN', async () => {
    await expect(ctx.get.execute({ actor: ownerActor() })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  test('nobody signed in gets UNAUTHENTICATED', async () => {
    await expect(ctx.get.execute({ actor: null })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});

describe('FR-8: save a settings section', () => {
  test('a saved secret is returned only as last4 and stored as ciphertext', async () => {
    const result = await ctx.update.execute({
      actor: staffActor(),
      section: 'email',
      input: {
        host: 'smtp.example.com',
        port: 2525,
        username: 'mailer',
        password: 'smtp-password-a1f3',
        tls: 'starttls',
        fromName: 'Llyner Leads',
        fromAddress: 'hello@llyner.test',
        replyTo: null,
      },
    });
    expect(settingsSections.email.parse(result)).toEqual(result);
    expect(result.password).toEqual({
      set: true,
      last4: 'a1f3',
      updatedAt: '2026-11-19T10:00:00.000Z',
    });
    const stored = ctx.uow.settings.rows.get('email');
    expect(JSON.stringify(stored)).not.toContain('smtp-password');
    const reloaded = await ctx.get.execute({ actor: staffActor() });
    expect(JSON.stringify(reloaded)).not.toContain('smtp-password');
    expect(reloaded.email.password.last4).toBe('a1f3');
  });

  test('FR-7: replacing the Anthropic key writes settings.ai.updated with field names only', async () => {
    await ctx.update.execute({
      actor: staffActor(),
      section: 'ai',
      input: { ...aiBase, anthropicApiKey: 'sk-ant-api03-zzzz9999' },
    });
    expect(ctx.uow.auditLog.entries).toHaveLength(1);
    const entry = ctx.uow.auditLog.entries[0];
    expect(entry).toMatchObject({
      staffMemberId: staffActor().memberId,
      businessId: null,
      action: 'settings.ai.updated',
      targetType: 'settings',
      targetId: 'ai',
      details: { fields: ['anthropicApiKey'] },
    });
    expect(JSON.stringify(entry)).not.toContain('sk-ant-api03');
  });

  test('omitting a secret keeps it; "" clears it', async () => {
    const actor = staffActor();
    await ctx.update.execute({
      actor,
      section: 'stripe',
      input: { secretKey: 'sk_test_12345678', webhookSecret: 'whsec_12345678', taxEnabled: true },
    });
    const kept = await ctx.update.execute({
      actor,
      section: 'stripe',
      input: { taxEnabled: false },
    });
    expect(kept.secretKey.set).toBe(true);
    expect(kept.taxEnabled).toBe(false);
    const cleared = await ctx.update.execute({
      actor,
      section: 'stripe',
      input: { secretKey: '', taxEnabled: false },
    });
    expect(cleared.secretKey).toEqual({ set: false, last4: null, updatedAt: null });
    expect(cleared.webhookSecret.set).toBe(true);
    expect(ctx.uow.auditLog.entries.map((e) => e.details)).toEqual([
      { fields: ['secretKey', 'webhookSecret'] },
      { fields: ['taxEnabled'] },
      { fields: ['secretKey'] },
    ]);
  });

  test('the server reads the decrypted secret right after a save (cache invalidated)', async () => {
    expect((await ctx.reader.ai()).anthropicApiKey).toBeNull();
    await ctx.update.execute({
      actor: staffActor(),
      section: 'ai',
      input: { ...aiBase, anthropicApiKey: 'sk-ant-new-key-0001' },
    });
    expect((await ctx.reader.ai()).anthropicApiKey).toBe('sk-ant-new-key-0001');
  });

  test('a non-Staff Member cannot save', async () => {
    await expect(
      ctx.update.execute({
        actor: ownerActor(),
        section: 'landing',
        input: { youtubeVideoId: null },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(ctx.uow.auditLog.entries).toHaveLength(0);
  });
});

describe('FR-8: settings tests', () => {
  test('runs the target check and returns its result', async () => {
    const tester = fakeConnectivityTester();
    const useCase = new TestSettings({ tester, reader: ctx.reader });
    const result = await useCase.execute({
      actor: staffActor(),
      target: 'smtp',
      to: 'ops@llyner.test',
    });
    expect(result).toEqual({ ok: true, message: 'Connected' });
    expect(tester.calls).toEqual([{ target: 'smtp', to: 'ops@llyner.test' }]);
  });

  test('times out with { ok: false, message: "Timed out" }', async () => {
    const tester = fakeConnectivityTester({
      anthropic: ({ signal }) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () => resolve({ ok: true, message: 'late' })),
        ),
    });
    const useCase = new TestSettings({ tester, reader: ctx.reader, timeoutMs: 20 });
    expect(await useCase.execute({ actor: staffActor(), target: 'anthropic' })).toEqual({
      ok: false,
      message: 'Timed out',
    });
  });

  test('a check that throws is a failed test, not a 500', async () => {
    const tester = fakeConnectivityTester({
      stripe: () => Promise.reject(new Error('socket hang up sk_live_secret')),
    });
    const result = await new TestSettings({ tester, reader: ctx.reader }).execute({
      actor: staffActor(),
      target: 'stripe',
    });
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain('sk_live');
  });

  test('a non-Staff Member cannot run tests', async () => {
    const tester = fakeConnectivityTester();
    await expect(
      new TestSettings({ tester, reader: ctx.reader }).execute({
        actor: ownerActor(),
        target: 'anthropic',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(tester.calls).toHaveLength(0);
  });
});

describe('FR-9: public config', () => {
  test('is all null by default', async () => {
    expect(await new GetPublicConfig({ reader: ctx.reader }).execute()).toEqual({
      gaMeasurementId: null,
      supportEmail: null,
      youtubeVideoId: null,
    });
  });

  test('returns the measurement ID, support email and video ID once set', async () => {
    const actor = staffActor();
    await ctx.update.execute({
      actor,
      section: 'analytics',
      input: { gaMeasurementId: 'G-ABC1234' },
    });
    await ctx.update.execute({
      actor,
      section: 'support',
      input: { supportEmail: 'help@llyner.test' },
    });
    await ctx.update.execute({
      actor,
      section: 'landing',
      input: { youtubeVideoId: 'dQw4w9WgXcQ' },
    });
    expect(await new GetPublicConfig({ reader: ctx.reader }).execute()).toEqual({
      gaMeasurementId: 'G-ABC1234',
      supportEmail: 'help@llyner.test',
      youtubeVideoId: 'dQw4w9WgXcQ',
    });
  });
});
