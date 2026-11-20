import { z } from 'zod';
import { defineContract, email, emailInput, id, isoDateTime, listQuery, page } from './common.js';

// Public config ----------------------------------------------------------------------------------

export const gaMeasurementId = z
  .string()
  .regex(/^G-[A-Za-z0-9]{4,12}$/, 'Use G- followed by 4–12 letters or digits');
export const youtubeVideoId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{11}$/, 'A YouTube video ID has 11 characters');

/** FR-9, FR-34. */
export const getPublicConfig = defineContract({
  method: 'GET',
  path: '/api/public/config',
  auth: 'public',
  status: 200,
  response: z.object({
    gaMeasurementId: gaMeasurementId.nullable(),
    supportEmail: email.nullable(),
    youtubeVideoId: youtubeVideoId.nullable(),
  }),
});

// Platform settings (FR-8) -------------------------------------------------------------------------

/** A write-only secret as the API returns it: never the value (ADR 0012). */
export const secret = z.object({
  set: z.boolean(),
  last4: z.string().max(4).nullable(),
  updatedAt: isoDateTime.nullable(),
});
export type Secret = z.infer<typeof secret>;

/** A secret in a save request: a string replaces it, `""` clears it, omitted keeps it. */
export const secretInput = z.string().max(1000).optional();

const modelId = z.string().trim().min(1).max(100);
const optionalText = (max: number) => z.string().trim().max(max).nullable();

export const tlsMode = z.enum(['starttls', 'tls', 'none']);

/** Platform ceilings: the highest values any Research flow or Plan may use. */
export const ceilings = z.object({
  maxCredits: z.int().min(10).max(1_000_000),
  maxLeads: z.int().min(10).max(10_000),
  maxActiveMinutes: z.int().min(5).max(1_440),
  maxTotalHours: z.number().min(1).max(72),
  maxAttempts: z.int().min(1).max(10),
  trialCredits: z.int().min(0).max(100_000),
});
export type Ceilings = z.infer<typeof ceilings>;

const providerKey = z.object({ apiKey: secret });
const providerKeyInput = z.object({ apiKey: secretInput });

/** Each section as GET returns it (secrets masked). */
export const settingsSections = {
  ai: z.object({
    anthropicApiKey: secret,
    planningModel: modelId,
    chatModel: modelId,
    fastModel: modelId,
  }),
  providers: z.object({
    apify: providerKey,
    googleMaps: providerKey,
    firecrawl: providerKey,
    apollo: providerKey,
    hunter: providerKey,
    zerobounce: providerKey,
    twilio: z.object({ accountSid: optionalText(64), authToken: secret }),
  }),
  email: z.object({
    host: optionalText(255),
    port: z.int().min(1).max(65_535),
    username: optionalText(255),
    password: secret,
    tls: tlsMode,
    fromName: z.string().trim().min(1).max(100),
    fromAddress: email.nullable(),
    replyTo: email.nullable(),
  }),
  stripe: z.object({ secretKey: secret, webhookSecret: secret, taxEnabled: z.boolean() }),
  analytics: z.object({ gaMeasurementId: gaMeasurementId.nullable() }),
  ceilings,
  landing: z.object({ youtubeVideoId: youtubeVideoId.nullable() }),
  support: z.object({ supportEmail: email.nullable() }),
} as const;

/** Each section as a save request takes it (secrets as `secretInput`). */
export const settingsSectionInputs = {
  ai: settingsSections.ai.extend({ anthropicApiKey: secretInput }),
  providers: z.object({
    apify: providerKeyInput,
    googleMaps: providerKeyInput,
    firecrawl: providerKeyInput,
    apollo: providerKeyInput,
    hunter: providerKeyInput,
    zerobounce: providerKeyInput,
    twilio: z.object({ accountSid: optionalText(64), authToken: secretInput }),
  }),
  email: settingsSections.email.extend({
    password: secretInput,
    fromAddress: emailInput.nullable(),
    replyTo: emailInput.nullable(),
  }),
  stripe: z.object({
    secretKey: secretInput,
    webhookSecret: secretInput,
    taxEnabled: z.boolean(),
  }),
  analytics: settingsSections.analytics,
  ceilings,
  landing: settingsSections.landing,
  support: z.object({ supportEmail: emailInput.nullable() }),
} as const;

export const settingsSection = z.enum([
  'ai',
  'providers',
  'email',
  'stripe',
  'analytics',
  'ceilings',
  'landing',
  'support',
]);
export type SettingsSection = z.infer<typeof settingsSection>;

export const platformSettings = z.object(settingsSections);
export type PlatformSettings = z.infer<typeof platformSettings>;

export const getSettings = defineContract({
  method: 'GET',
  path: '/api/staff/settings',
  auth: 'staff',
  status: 200,
  response: platformSettings,
});

function updateSection<S extends SettingsSection>(section: S) {
  return defineContract({
    method: 'PUT',
    path: `/api/staff/settings/${section}`,
    auth: 'staff',
    status: 200,
    body: settingsSectionInputs[section],
    response: settingsSections[section],
  });
}

/** `PUT /api/staff/settings/:section`, one contract per section. Each save is one Audit log entry. */
export const updateSettings = {
  ai: updateSection('ai'),
  providers: updateSection('providers'),
  email: updateSection('email'),
  stripe: updateSection('stripe'),
  analytics: updateSection('analytics'),
  ceilings: updateSection('ceilings'),
  landing: updateSection('landing'),
  support: updateSection('support'),
} as const;

export const settingsTestTarget = z.enum([
  'anthropic',
  'apify',
  'googleMaps',
  'firecrawl',
  'apollo',
  'hunter',
  'zerobounce',
  'twilio',
  'smtp',
  'stripe',
]);
export type SettingsTestTarget = z.infer<typeof settingsTestTarget>;

/** FR-8 "Test" actions; `to` is required for `smtp`. Times out at 15 s with `{ ok: false }`. */
export const testSettings = defineContract({
  method: 'POST',
  path: '/api/staff/settings/test',
  auth: 'staff',
  status: 200,
  body: z
    .object({ target: settingsTestTarget, to: emailInput.optional() })
    .refine((b) => b.target !== 'smtp' || b.to !== undefined, {
      path: ['to'],
      message: 'Enter the address to send the test email to',
    }),
  response: z.object({ ok: z.boolean(), message: z.string() }),
});

// Audit log (FR-7) ---------------------------------------------------------------------------------

export const auditLogEntry = z.object({
  id,
  at: isoDateTime,
  staff: z.object({ id, email }),
  business: z.object({ id, name: z.string() }).nullable(),
  /** Dot-named, e.g. `acting_as.started`, `plan.updated`, `settings.ai.updated`. */
  action: z.string().min(1).max(64),
  targetType: z.string().min(1).max(64),
  targetId: z.string().max(64).nullable(),
  /** Never secrets: changed field names, not values. */
  details: z.record(z.string(), z.unknown()),
});
export type AuditLogEntry = z.infer<typeof auditLogEntry>;

export const listAuditLog = defineContract({
  method: 'GET',
  path: '/api/staff/audit-log',
  auth: 'staff',
  status: 200,
  query: listQuery(50).extend({
    businessId: id.optional(),
    staffMemberId: id.optional(),
    action: z.string().min(1).max(64).optional(),
  }),
  response: page(auditLogEntry),
});

export const platformContracts = {
  getPublicConfig,
  getSettings,
  updateAiSettings: updateSettings.ai,
  updateProvidersSettings: updateSettings.providers,
  updateEmailSettings: updateSettings.email,
  updateStripeSettings: updateSettings.stripe,
  updateAnalyticsSettings: updateSettings.analytics,
  updateCeilingsSettings: updateSettings.ceilings,
  updateLandingSettings: updateSettings.landing,
  updateSupportSettings: updateSettings.support,
  testSettings,
  listAuditLog,
} as const;
