import { describe, expect, test } from 'vitest';
import {
  emptySection,
  last4Of,
  planSectionUpdate,
  presentSection,
  withDefaults,
  type SealedSecret,
  type StoredSection,
} from './settings.js';

const sealed = (last4: string | null): SealedSecret => ({
  ciphertext: 'c',
  iv: 'i',
  tag: 't',
  last4,
  updatedAt: new Date('2026-11-19T10:00:00.000Z'),
});

const aiInput = {
  planningModel: 'claude-opus-5-5',
  chatModel: 'claude-sonnet-5-5',
  fastModel: 'claude-haiku-5-5',
};

describe('FR-8: platform settings defaults', () => {
  test('models default to opus planning, sonnet chat, haiku fast', () => {
    expect(withDefaults('ai', {})).toEqual(aiInput);
  });

  test('SMTP defaults to port 2525, STARTTLS and from name "Llyner Leads"', () => {
    expect(withDefaults('email', {})).toMatchObject({
      port: 2525,
      tls: 'starttls',
      fromName: 'Llyner Leads',
    });
  });

  test('Stripe Tax is on by default', () => {
    expect(withDefaults('stripe', {})).toEqual({ taxEnabled: true });
  });

  test('ceilings default to 1,000 credits, 500 leads, 120 min, 4 h, 5 attempts, 50 trial credits', () => {
    expect(withDefaults('ceilings', {})).toEqual({
      maxCredits: 1000,
      maxLeads: 500,
      maxActiveMinutes: 120,
      maxTotalHours: 4,
      maxAttempts: 5,
      trialCredits: 50,
    });
  });

  test('stored values override defaults, nested values merge', () => {
    expect(withDefaults('providers', { twilio: { accountSid: 'AC1' } })).toMatchObject({
      twilio: { accountSid: 'AC1' },
      apify: {},
    });
  });
});

describe('FR-8: secrets are write-only', () => {
  test('a new secret is a change and its name (not value) is a changed field', () => {
    const plan = planSectionUpdate(emptySection('ai'), {
      ...aiInput,
      anthropicApiKey: 'sk-ant-123456',
    });
    expect(plan.secretChanges).toEqual([{ path: 'anthropicApiKey', value: 'sk-ant-123456' }]);
    expect(plan.changedFields).toEqual(['anthropicApiKey']);
    expect(plan.values).toEqual(aiInput);
    expect(JSON.stringify(plan.changedFields)).not.toContain('sk-ant');
  });

  test('omitting a secret keeps it (no change)', () => {
    const current: StoredSection = {
      ...emptySection('ai'),
      secrets: { anthropicApiKey: sealed('1234') },
    };
    const plan = planSectionUpdate(current, aiInput);
    expect(plan.secretChanges).toEqual([]);
    expect(plan.changedFields).toEqual([]);
  });

  test('an empty string clears a set secret', () => {
    const current: StoredSection = {
      ...emptySection('email'),
      secrets: { password: sealed('abcd') },
    };
    const plan = planSectionUpdate(current, { ...withDefaults('email', {}), password: '' });
    expect(plan.secretChanges).toEqual([{ path: 'password', value: null }]);
    expect(plan.changedFields).toEqual(['password']);
  });

  test('an empty string for a secret that is not set changes nothing', () => {
    const plan = planSectionUpdate(emptySection('email'), {
      ...withDefaults('email', {}),
      password: '',
    });
    expect(plan.secretChanges).toEqual([]);
  });

  test('nested provider secrets use dot paths', () => {
    const plan = planSectionUpdate(emptySection('providers'), {
      apify: { apiKey: 'apify_api_abcdef' },
      googleMaps: {},
      firecrawl: {},
      apollo: {},
      hunter: {},
      zerobounce: {},
      twilio: { accountSid: 'AC123', authToken: 'tok_123456789' },
    });
    expect(plan.secretChanges.map((c) => c.path)).toEqual(['apify.apiKey', 'twilio.authToken']);
    expect(plan.changedFields).toEqual(['apify.apiKey', 'twilio.accountSid', 'twilio.authToken']);
    expect(plan.values).toEqual({ twilio: { accountSid: 'AC123' } });
  });

  test('changed plain fields are listed by name', () => {
    const plan = planSectionUpdate(emptySection('ceilings'), {
      ...withDefaults('ceilings', {}),
      maxLeads: 800,
    });
    expect(plan.changedFields).toEqual(['maxLeads']);
  });

  test('the hint shows the last 4 characters only for secrets of 8 or more characters', () => {
    expect(last4Of('sk-ant-a1f3')).toBe('a1f3');
    expect(last4Of('short')).toBeNull();
  });

  test('presenting a section masks every secret', () => {
    const view = presentSection({
      ...emptySection('stripe'),
      secrets: { secretKey: sealed('9xyz') },
    });
    expect(view).toEqual({
      taxEnabled: true,
      secretKey: { set: true, last4: '9xyz', updatedAt: '2026-11-19T10:00:00.000Z' },
      webhookSecret: { set: false, last4: null, updatedAt: null },
    });
  });
});
