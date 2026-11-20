import type { Logger } from 'pino';
import type { AppDeps, AppModule } from './app.js';
import type { Config } from './config/env.js';
import { createAssistant } from './modules/assistant/index.js';
import { createBilling, createPaymentGateway, type Billing } from './modules/billing/index.js';
import {
  createActorResolver,
  createIdentityModule,
  createIdentityQueries,
  type IdentityQueries,
  type SecretCipher,
} from './modules/identity/index.js';
import { leadsModule } from './modules/leads/index.js';
import { createPlanning, type Planning, type ProfileView } from './modules/planning/index.js';
import {
  createAuditLog,
  createDbAnalyticsTracker,
  createPlatformModule,
  createPlatformRouteDeps,
  createSecretBox,
  createSettingsReader,
  createSmtpEmailSender,
  type AuditDirectory,
  type AuditRecorder,
  type SecretBox,
  type SettingsReader,
} from './modules/platform/index.js';
import { createProfile } from './modules/profile/index.js';
import { reportingModule } from './modules/reporting/index.js';
import { researchModule } from './modules/research/index.js';
import { toolsModule } from './modules/tools/index.js';
import type { AnalyticsTracker } from './shared/application/analytics-tracker.js';
import type { Geocoder } from './shared/application/geocoder.js';
import type { LlmClient } from './shared/application/llm-client.js';
import type { Clock } from './shared/domain/clock.js';
import type { IdGenerator } from './shared/domain/id-generator.js';
import type { Database } from './shared/infrastructure/db/database.js';
import { FixtureGeocoder } from './shared/infrastructure/geo/fixture-geocoder.js';
import { AnthropicLlmClient } from './shared/infrastructure/llm/anthropic-llm-client.js';
import { fakePlanDraft } from './shared/infrastructure/llm/fake-plan-draft.js';
import { fakeWelcomeChat } from './shared/infrastructure/llm/fake-welcome-chat.js';
import { ScriptedLlmClient } from './shared/infrastructure/llm/scripted-llm-client.js';
import { SystemClock } from './shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from './shared/infrastructure/time/uuid7.js';

/** What both processes (api and worker) build from config and the database. */
export interface CoreServices {
  clock: Clock;
  ids: IdGenerator;
  secretBox: SecretBox;
  settings: SettingsReader;
  auditLog: AuditRecorder;
  analytics: AnalyticsTracker;
  /** platform's ceilings.trialCredits, read at grant time. */
  trialCredits: { trialCredits(): Promise<number> };
}

export function composeCore(config: Config, db: Database, logger: Logger): CoreServices {
  const clock = new SystemClock();
  const ids = new Uuid7Generator();
  const secretBox = createSecretBox(config);
  const settings = createSettingsReader({ db, secretBox, clock });
  return {
    clock,
    ids,
    secretBox,
    settings,
    auditLog: createAuditLog({ db, clock, ids }),
    analytics: createDbAnalyticsTracker({ db, clock, ids, logger }),
    trialCredits: { trialCredits: async () => (await settings.ceilings()).trialCredits },
  };
}

/** AAD for the Staff TOTP secret; changing it makes every stored secret unreadable. */
const TOTP_CONTEXT = 'identity.totpSecret';

/**
 * identity's SecretCipher (string in, string out) on platform's SecretBox (AES-256-GCM with a
 * context, ADR 0012). The sealed value is stored as JSON `{ ciphertext, iv, tag }`.
 */
export function createTotpCipher(secretBox: SecretBox): SecretCipher {
  return {
    encrypt: (plain) => JSON.stringify(secretBox.encrypt(plain, TOTP_CONTEXT)),
    decrypt: (sealed) =>
      secretBox.decrypt(
        JSON.parse(sealed) as { ciphertext: string; iv: string; tag: string },
        TOTP_CONTEXT,
      ),
  };
}

/**
 * Staff emails and Business names for the Audit log (platform's AuditDirectory). Business names
 * come from identity's public queries; member emails are read from identity's `members` table
 * directly because identity has no batched member lookup yet.
 * TODO(identity): expose `getMemberEmails(ids)` on IdentityQueries and use it here.
 */
export function createAuditDirectory(db: Database, identity: IdentityQueries): AuditDirectory {
  return {
    async lookup({ memberIds, businessIds }) {
      const [members, businesses] = await Promise.all([
        memberIds.length === 0
          ? Promise.resolve([])
          : db
              .selectFrom('members')
              .select(['id', 'email'])
              .where('id', 'in', [...new Set(memberIds)])
              .execute(),
        identity.getBusinesses(businessIds),
      ]);
      return {
        members: new Map(members.map((m) => [m.id, { email: m.email }])),
        businesses: new Map(businesses.map((b) => [b.id, { name: b.name }])),
      };
    },
  };
}

/**
 * Claude for the assistant and planning. With TOOLS_MODE=fake, a scripted fake (no API key) that
 * walks the welcome chat and drafts Plans from a Goal.
 */
export function createLlmClient(config: Config, settings: SettingsReader): LlmClient {
  if (config.TOOLS_MODE !== 'fake') return new AnthropicLlmClient({ settings });
  return new ScriptedLlmClient((request) =>
    request.purpose === 'planning.draft' ? fakePlanDraft(request) : fakeWelcomeChat(request),
  );
}

/**
 * The Geocoder for profile, planning and the assistant.
 * TODO(W3, tools): use the live Google geocoder in live mode once the tools module provides it;
 * until then both modes use the fixture places.
 */
export function createGeocoder(config: Config, logger: Logger): Geocoder {
  if (config.TOOLS_MODE === 'live') {
    logger.warn('TOOLS_MODE=live but no live geocoder exists yet (W3); using FixtureGeocoder');
  }
  return new FixtureGeocoder();
}

export interface ComposedApp {
  core: CoreServices;
  deps: AppDeps;
  modules: readonly AppModule[];
  billing: Billing;
  /** Closes what the composition opened (the SMTP transport). */
  close(): void;
}

/** The api's composition root: every module wired to MySQL and its collaborators. */
export function composeApp(
  config: Config,
  infra: { db: Database; logger: Logger; health: AppDeps['health']; features: AppDeps['features'] },
): ComposedApp {
  const { db, logger } = infra;
  const core = composeCore(config, db, logger);
  const { clock, ids, secretBox, settings, auditLog, analytics } = core;
  const email = createSmtpEmailSender({ settings });
  const identityQueries = createIdentityQueries({ db, clock, ids });

  const identity = createIdentityModule({
    db,
    cipher: createTotpCipher(secretBox),
    audit: auditLog,
    appUrl: config.APP_URL,
    secureCookies: config.NODE_ENV === 'production',
    clock,
    ids,
    analytics,
    email,
  });

  const platform = createPlatformModule(
    createPlatformRouteDeps({
      db,
      secretBox,
      settings,
      email,
      clock,
      ids,
      directory: createAuditDirectory(db, identityQueries),
    }),
  );

  const billing = createBilling({
    db,
    clock,
    ids,
    analytics,
    gateway: createPaymentGateway({
      fake: config.TOOLS_MODE === 'fake',
      settings: { stripe: () => settings.stripe() },
      ids,
      appUrl: config.APP_URL,
    }),
    audit: auditLog,
    businesses: { exists: async (id) => (await identityQueries.getBusiness(id)) !== null },
    trialCredits: core.trialCredits,
    appUrl: config.APP_URL,
    testHooks: config.ENABLE_TEST_HOOKS && config.NODE_ENV !== 'production',
  });

  const llm = createLlmClient(config, settings);
  const geocoder = createGeocoder(config, logger);

  // profile's ProductUsage asks planning, which is built after profile (it reads profiles).
  let planning: Planning | null = null;
  const profile = createProfile({
    db,
    clock,
    ids,
    analytics,
    geocoder,
    businesses: {
      getName: async (id) => (await identityQueries.getBusiness(id))?.name ?? null,
      rename: (id, name) => identityQueries.renameBusiness(id, name),
    },
    productUsage: {
      isInUse: (businessId, productId) =>
        planning
          ? planning.planningQueries.productInUse(businessId, productId)
          : Promise.resolve(false),
    },
  });

  planning = createPlanning({
    db,
    clock,
    ids,
    analytics,
    llm,
    geocoder,
    profiles: {
      async getProfile(businessId): Promise<ProfileView> {
        const p = await profile.profileQueries.getProfile(businessId);
        return {
          complete: p.complete,
          location: p.location,
          deliveryRadiusMiles: p.deliveryRadiusMiles,
          products: p.products,
        };
      },
    },
    wallet: {
      available: async (businessId) =>
        (await billing.billingQueries.getWallet(businessId)).available,
    },
    // flows, runStats and activity: planning's defaults until research and leads land (W3/W4).
  });

  const assistant = createAssistant({
    db,
    clock,
    ids,
    llm,
    geocoder,
    profile: {
      getProfile: profile.profileQueries.getProfile,
      applyUpdates: profile.profileCommands.applyUpdates,
    },
    planDrafter: planning.planningCommands,
  });

  const deps: AppDeps = {
    logger,
    clock,
    ids,
    analytics,
    email,
    features: infra.features,
    health: infra.health,
    resolveActor: createActorResolver({ db, clock, ids }),
    auditTrail: auditLog,
  };

  const modules: readonly AppModule[] = [
    identity,
    platform,
    billing.module,
    profile.module,
    assistant.module,
    planning.module,
    researchModule,
    toolsModule,
    leadsModule,
    reportingModule,
  ];

  return { core, deps, modules, billing, close: () => email.close() };
}
