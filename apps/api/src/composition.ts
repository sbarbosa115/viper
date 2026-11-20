import type { Redis } from 'ioredis';
import type { Transaction } from 'kysely';
import type { Logger } from 'pino';
import type { AppDeps, AppModule } from './app.js';
import type { Config } from './config/env.js';
import { createAssistant } from './modules/assistant/index.js';
import { createBilling, createPaymentGateway, type Billing } from './modules/billing/index.js';
import {
  createActorResolver,
  createIdentityModule,
  createIdentityQueries,
  createIdentityUseCasesFor,
  type IdentityDeps,
  type IdentityQueries,
  type SecretCipher,
} from './modules/identity/index.js';
import { createLeads, type Leads } from './modules/leads/index.js';
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
import { createProfile, type Profile } from './modules/profile/index.js';
import { createReporting } from './modules/reporting/index.js';
import {
  createResearch,
  fakeResearchAgent,
  isResearchRequest,
  type Research,
  type ResearchCollaborators,
} from './modules/research/index.js';
import {
  createFakeToolControls,
  createGoogleGeocoder,
  createTools,
  type Tools,
} from './modules/tools/index.js';
import { researchProspectStore } from './research-prospects.js';
import { fileLegalContent } from './site/legal-content.js';
import type { AnalyticsTracker } from './shared/application/analytics-tracker.js';
import type { Geocoder } from './shared/application/geocoder.js';
import type { LlmClient } from './shared/application/llm-client.js';
import type { Clock } from './shared/domain/clock.js';
import { AppError, CodedError } from './shared/domain/errors.js';
import type { IdGenerator } from './shared/domain/id-generator.js';
import type { Database } from './shared/infrastructure/db/database.js';
import type { DB } from './shared/infrastructure/db/schema.js';
import { FixtureGeocoder } from './shared/infrastructure/geo/fixture-geocoder.js';
import { AnthropicLlmClient } from './shared/infrastructure/llm/anthropic-llm-client.js';
import { fakeModeAnswer } from './shared/infrastructure/llm/fake-mode.js';
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

/** Staff emails and Business names for the Audit log (platform's AuditDirectory), from identity. */
export function createAuditDirectory(identity: IdentityQueries): AuditDirectory {
  return {
    async lookup({ memberIds, businessIds }) {
      const [emails, businesses] = await Promise.all([
        identity.getMemberEmails(memberIds),
        identity.getBusinesses(businessIds),
      ]);
      return {
        members: new Map([...emails].map(([id, email]) => [id, { email }])),
        businesses: new Map(businesses.map((b) => [b.id, { name: b.name }])),
      };
    },
  };
}

/**
 * Claude for the assistant, planning and (through the tools module's ToolRunner) research's run
 * Steps. With TOOLS_MODE=fake, a scripted fake (no API key): research's agent for run Steps, the
 * shared fakes for Plan drafts and the welcome chat.
 */
export function createLlmClient(config: Config, settings: SettingsReader): LlmClient {
  if (config.TOOLS_MODE !== 'fake') return new AnthropicLlmClient({ settings });
  return new ScriptedLlmClient((request) =>
    isResearchRequest(request) ? fakeResearchAgent(request) : fakeModeAnswer(request),
  );
}

/**
 * The Geocoder for profile, planning and the assistant: Google live, fixture places in fake mode.
 * No match is an empty list; any other failure (quota, key, network) is 503 GEOCODER_UNAVAILABLE.
 */
export function createGeocoder(config: Config, settings: SettingsReader): Geocoder {
  return unavailableAs503(
    config.TOOLS_MODE === 'live' ? createGoogleGeocoder(settings) : new FixtureGeocoder(),
  );
}

/** Maps a geocoder's provider errors to 503 GEOCODER_UNAVAILABLE (the error handler's 500 otherwise). */
export function unavailableAs503(geocoder: Geocoder): Geocoder {
  return {
    async search(query, limit) {
      try {
        return await geocoder.search(query, limit);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new CodedError(
          'GEOCODER_UNAVAILABLE',
          "We couldn't look up places just now. Try again in a moment.",
          undefined,
          503,
        );
      }
    },
  };
}

/** Fake-mode Tool retries wait 10 ms instead of 1 s, 4 s, 16 s, so failure journeys are fast. */
export const FAKE_RETRY_DELAYS_MS: readonly number[] = [10, 10, 10];

/** What composeModules needs besides config. */
export interface ModuleInfra {
  db: Database;
  logger: Logger;
  /** Valkey: research's queues and the fake Tools' error modes shared by api and worker. */
  redis: Redis;
}

/** Every module wired to MySQL, Valkey and its collaborators (api and worker). */
export interface ComposedModules {
  core: CoreServices;
  email: ReturnType<typeof createSmtpEmailSender>;
  identityQueries: IdentityQueries;
  llm: LlmClient;
  geocoder: Geocoder;
  billing: Billing;
  tools: Tools;
  profile: Profile;
  planning: Planning;
  leads: Leads;
  research: Research;
  /** research's collaborators, for the worker's research workers. */
  researchCollaborators: ResearchCollaborators & { testHooks: boolean };
  testHooks: boolean;
}

/** Credits spent by a Plan's runs (or one run), from research's store (leads' stats strip). */
async function creditsSpentForPlan(
  research: Research,
  businessId: string,
  planId: string,
  runId?: string,
): Promise<number> {
  if (runId) {
    const run = await research.store.transaction((tx) => tx.runs.find(runId));
    const s = run?.toSnapshot();
    return s?.businessId === businessId && s.planId === planId ? s.creditsSpent : 0;
  }
  let total = 0;
  let after: { queuedAt: Date; id: string } | undefined;
  for (;;) {
    const page = await research.store.transaction((tx) =>
      tx.runs.listForPlan(businessId, planId, { ...(after ? { after } : {}), limit: 100 }),
    );
    for (const run of page) total += run.toSnapshot().creditsSpent;
    const last = page.at(-1)?.toSnapshot();
    if (!last || page.length < 100) return total;
    after = { queuedAt: last.queuedAt, id: last.id };
  }
}

export function composeModules(config: Config, infra: ModuleInfra): ComposedModules {
  const { db, logger, redis } = infra;
  const core = composeCore(config, db, logger);
  const { clock, ids, settings, auditLog, analytics } = core;
  const testHooks = config.ENABLE_TEST_HOOKS && config.NODE_ENV !== 'production';
  const email = createSmtpEmailSender({ settings });
  const identityQueries = createIdentityQueries({ db, clock, ids, audit: auditLog });

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
    testHooks,
  });

  const llm = createLlmClient(config, settings);
  const geocoder = createGeocoder(config, settings);

  const tools = createTools({
    db,
    clock,
    ids,
    settings,
    llm,
    audit: auditLog,
    mode: config.TOOLS_MODE,
    testHooks,
    fakeControls: createFakeToolControls({ redis }),
    ...(config.TOOLS_MODE === 'fake' ? { retryDelaysMs: FAKE_RETRY_DELAYS_MS } : {}),
    onMeterError: (err, usage) =>
      logger.warn({ err, purpose: usage.purpose }, 'could not meter a Claude call'),
  });

  // Modules that need each other are wired lazily: planning is built last (it reads research and
  // leads), profile asks planning whether a Product is in use.
  let planning: Planning | null = null;
  let research: Research | null = null;
  const needPlanning = (): Planning => {
    if (!planning) throw new Error('planning is not composed yet');
    return planning;
  };
  const needResearch = (): Research => {
    if (!research) throw new Error('research is not composed yet');
    return research;
  };

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

  const products = {
    names: async (businessId: string): Promise<ReadonlyMap<string, string>> =>
      new Map((await profile.profileQueries.listProducts(businessId)).map((p) => [p.id, p.name])),
  };

  const leads = createLeads({
    db,
    clock,
    ids,
    analytics,
    plans: {
      async findPlan(businessId, planId) {
        const plan = await needPlanning().planningQueries.getPlanSnapshot(businessId, planId);
        return plan
          ? {
              id: plan.id,
              name: plan.name,
              centre: { lat: plan.searchArea.lat, lng: plan.searchArea.lng },
            }
          : null;
      },
    },
    runCosts: {
      creditsSpentForPlan: (businessId, planId, runId) =>
        creditsSpentForPlan(needResearch(), businessId, planId, runId),
    },
  });

  const researchCollaborators: ResearchCollaborators & { testHooks: boolean } = {
    clock,
    ids,
    analytics,
    billing: billing.billingCommands,
    plans: {
      getPlanSnapshot: (businessId, planId) =>
        needPlanning().planningQueries.getPlanSnapshot(businessId, planId),
    },
    tools: {
      call: (req) =>
        tools.toolRunner.call({ ...req, within: req.within as Transaction<DB> | undefined }),
    },
    catalog: {
      availability: async (keys) =>
        new Map(
          (await tools.toolQueries.availability(keys)).map((a) => [
            a.key,
            a.enabled && a.configured,
          ]),
        ),
    },
    toolCalls: {
      listForRun: async (runId) =>
        (await tools.toolQueries.callsForRun(runId)).map((c) => ({ ...c, attemptN: c.attempt })),
    },
    prospects: researchProspectStore(leads.prospectStore, { products }),
    identity: {
      getOwnerContact: (businessId) => identityQueries.getOwnerContact(businessId),
      getBusinesses: (businessIds) => identityQueries.getBusinesses(businessIds),
    },
    settings,
    audit: auditLog,
    email,
    products,
    appUrl: config.APP_URL,
    testHooks,
  };

  research = createResearch({
    ...researchCollaborators,
    db,
    queue: { connection: redis },
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
    flows: research.flowDefaults,
    runStats: research.runStats,
    activity: {
      lastRuns: (businessId, planIds) => needResearch().planActivity.lastRuns(businessId, planIds),
      leadsCounts: (businessId, planIds) => leads.leadsQueries.leadsCounts(businessId, planIds),
    },
  });

  return {
    core,
    email,
    identityQueries,
    llm,
    geocoder,
    billing,
    tools,
    profile,
    planning,
    leads,
    research,
    researchCollaborators,
    testHooks,
  };
}

export interface ComposedApp {
  core: CoreServices;
  deps: AppDeps;
  modules: readonly AppModule[];
  billing: Billing;
  /** Closes what the composition opened (the SMTP transport). */
  close(): void;
}

/** The api's composition root: every module wired to MySQL, Valkey and its collaborators. */
export function composeApp(
  config: Config,
  infra: ModuleInfra & { health: AppDeps['health']; features: AppDeps['features'] },
): ComposedApp {
  const { db, logger } = infra;
  const m = composeModules(config, infra);
  const { core, email, identityQueries, llm, geocoder, billing, tools } = m;
  const { profile, planning, leads, research } = m;
  const { clock, ids, secretBox, settings, auditLog, analytics } = core;

  const identityDeps: IdentityDeps = {
    db,
    cipher: createTotpCipher(secretBox),
    audit: auditLog,
    appUrl: config.APP_URL,
    secureCookies: config.NODE_ENV === 'production',
    clock,
    ids,
    analytics,
    email,
  };
  const identity = createIdentityModule(identityDeps);

  const platform = createPlatformModule(
    createPlatformRouteDeps({
      db,
      secretBox,
      settings,
      email,
      clock,
      ids,
      directory: createAuditDirectory(identityQueries),
    }),
  );

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
    usage: tools.llmUsageMeter,
  });

  const reporting = createReporting({
    clock,
    audit: auditLog,
    identity: {
      allBusinesses: () => identityQueries.allBusinesses(),
      listBusinesses: (query) => identityQueries.listBusinesses(query),
      getBusiness: (id) => identityQueries.getBusiness(id),
      getOwnerContact: (businessId) => identityQueries.getOwnerContact(businessId),
      setBusinessInternal: (businessId, internal, by) =>
        identityQueries.setBusinessInternal(businessId, internal, by),
    },
    billing: {
      creditsSummary: (filter) => billing.billingQueries.creditsSummary(filter),
      availableByBusiness: (ids) => billing.billingQueries.availableByBusiness(ids),
      payingBusinessIds: (ids, options) => billing.billingQueries.payingBusinessIds(ids, options),
    },
    research: {
      runFacts: (window) => research.reportingQueries.runFacts(window),
      runCounts: (ids) => research.reportingQueries.runCounts(ids),
    },
    leads: leads.leadsQueries,
    tools: { spendByTool: (window) => tools.toolQueries.spendByTool(window) },
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
    site: {
      siteUrl: config.APP_URL,
      secureCookies: config.NODE_ENV === 'production',
      clock,
      packs: { activePacks: () => billing.billingQueries.activePacks() },
      settings,
      identity: createIdentityUseCasesFor(identityDeps),
      legal: fileLegalContent(),
    },
  };

  const modules: readonly AppModule[] = [
    identity,
    platform,
    billing.module,
    profile.module,
    assistant.module,
    planning.module,
    research.module,
    tools.module,
    leads.module,
    reporting.module,
  ];

  return { core, deps, modules, billing, close: () => email.close() };
}
