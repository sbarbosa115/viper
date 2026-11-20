import type { Worker } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { AnalyticsTracker } from '../../shared/application/analytics-tracker.js';
import type { EmailSender } from '../../shared/application/email-sender.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type { Database } from '../../shared/infrastructure/db/database.js';
import { KyselyUnitOfWork } from '../../shared/infrastructure/db/unit-of-work.js';
import type { OutboxSubscription } from '../../shared/infrastructure/outbox/index.js';
import { AuditLog, ListAuditLog, type AuditRecorder } from './application/audit-log.js';
import type { AuditDirectory, ConnectivityTester, SecretBox } from './application/ports.js';
import { CachedSettingsReader, type SettingsReader } from './application/settings-reader.js';
import {
  GetPublicConfig,
  GetSettings,
  TestSettings,
  UpdateSettingsSection,
  type SettingsRepos,
} from './application/settings-use-cases.js';
import { SETTINGS_SECTIONS, withDefaults, type SettingsSectionKey } from './domain/settings.js';
import { platformRoutes, type PlatformRouteDeps } from './http/platform.routes.js';
import { createConnectivityTester } from './infrastructure/connectivity/index.js';
import { DbAnalyticsTracker } from './infrastructure/db-analytics-tracker.js';
import { KyselyAuditLogRepository } from './infrastructure/kysely-audit-log-repository.js';
import { KyselySettingsRepository } from './infrastructure/kysely-settings-repository.js';
import { createSecretBox } from './infrastructure/secret-box.js';
import { SmtpEmailSender } from './infrastructure/smtp-email-sender.js';

export type { AuditRecord, AuditRecorder } from './application/audit-log.js';
export type { AuditDirectory, ConnectivityTester, SecretBox } from './application/ports.js';
export type {
  AiSettings,
  AnalyticsSettings,
  EmailSettings,
  LandingSettings,
  ProviderCredentials,
  SettingsReader,
  StripeSettings,
  SupportSettings,
} from './application/settings-reader.js';
export type { ProviderKey } from './domain/settings.js';
export { DEFAULT_CEILINGS, DEFAULT_MODELS } from './domain/settings.js';
export { registerAuditTrail } from './http/audit-trail.js';
export { createSecretBox } from './infrastructure/secret-box.js';
export { EmailNotConfiguredError } from './infrastructure/smtp-email-sender.js';

const MODULE_NAME = 'platform';

/**
 * platform: Platform settings with encrypted secrets, Audit log, analytics events, email sending
 * (FR-7 to FR-9). Its routes need dependencies, so main.ts registers
 * `createPlatformModule(...)` in place of this placeholder, which only keeps app.ts's module
 * list complete.
 */
export const platformModule = {
  name: MODULE_NAME,
  register(_app: FastifyInstance): void {
    // Intentionally empty: see createPlatformModule.
  },
};

/** The platform AppModule with its use cases (tests pass fakes). */
export function createPlatformModule(deps: PlatformRouteDeps) {
  return {
    name: MODULE_NAME,
    register(app: FastifyInstance): void {
      platformRoutes(app, deps);
    },
  };
}

/** SettingsReader for api and worker: decrypted values, cached at most 60 s. */
export function createSettingsReader(deps: {
  db: Database;
  secretBox: SecretBox;
  clock: Clock;
}): SettingsReader {
  return new CachedSettingsReader({
    repository: new KyselySettingsRepository(deps.db),
    secretBox: deps.secretBox,
    clock: deps.clock,
  });
}

/** The Audit log's write side (identity's AuditRecorder, back-office writes in every module). */
export function createAuditLog(deps: { db: Database; clock: Clock; ids: IdGenerator }): AuditRecorder {
  return new AuditLog({
    repository: new KyselyAuditLogRepository(deps.db),
    clock: deps.clock,
    ids: deps.ids,
  });
}

/** The SMTP EmailSender (ADR 0013), configured from Platform settings at send time. */
export function createSmtpEmailSender(deps: { settings: SettingsReader }): EmailSender & {
  close(): void;
} {
  return new SmtpEmailSender(deps);
}

/** The AnalyticsTracker writing `analytics_events` (replaces the shared stub). */
export function createDbAnalyticsTracker(deps: {
  db: Database;
  clock: Clock;
  ids: IdGenerator;
  logger?: Pick<Logger, 'warn'>;
}): AnalyticsTracker {
  return new DbAnalyticsTracker({
    db: deps.db,
    clock: deps.clock,
    ids: deps.ids,
    onError: (err, event) => deps.logger?.warn({ err, event: event.name }, 'analytics event lost'),
  });
}

/** Builds every platform use case on the database: what main.ts registers. */
export function createPlatformRouteDeps(deps: {
  db: Database;
  secretBox: SecretBox;
  settings: SettingsReader;
  email: EmailSender;
  directory: AuditDirectory;
  clock: Clock;
  ids: IdGenerator;
  /** Defaults to the live adapters; never live in tests. */
  tester?: ConnectivityTester;
}): PlatformRouteDeps {
  const settingsRepository = new KyselySettingsRepository(deps.db);
  const uow = new KyselyUnitOfWork<SettingsRepos>(deps.db, (trx) => ({
    settings: new KyselySettingsRepository(trx),
    auditLog: new KyselyAuditLogRepository(trx),
  }));
  const tester =
    deps.tester ?? createConnectivityTester({ settings: deps.settings, email: deps.email });
  return {
    getSettings: new GetSettings({ repository: settingsRepository }),
    updateSettingsSection: new UpdateSettingsSection({
      uow,
      secretBox: deps.secretBox,
      reader: deps.settings,
      clock: deps.clock,
      ids: deps.ids,
    }),
    testSettings: new TestSettings({ tester, reader: deps.settings }),
    getPublicConfig: new GetPublicConfig({ reader: deps.settings }),
    listAuditLog: new ListAuditLog({
      repository: new KyselyAuditLogRepository(deps.db),
      directory: deps.directory,
    }),
  };
}

/** Dev/demo Platform settings (PRD section 8a): SMTP → Mailpit, fake provider keys. */
const DEMO_SETTINGS: Readonly<Record<SettingsSectionKey, Record<string, unknown>>> = {
  ai: { ...withDefaults('ai', {}), anthropicApiKey: 'sk-ant-fake-dev-key-0000' },
  providers: {
    apify: { apiKey: 'apify_api_fake_dev_0000' },
    googleMaps: { apiKey: 'gmaps-fake-dev-key-0000' },
    firecrawl: { apiKey: 'fc-fake-dev-key-0000' },
    apollo: { apiKey: 'apollo-fake-dev-key-0000' },
    hunter: { apiKey: 'hunter-fake-dev-key-0000' },
    zerobounce: { apiKey: 'zb-fake-dev-key-0000' },
    twilio: { accountSid: 'ACfakedev0000', authToken: 'twilio-fake-dev-token-0000' },
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
  stripe: {
    secretKey: 'sk_test_fake_dev_0000',
    webhookSecret: 'whsec_fake_dev_0000',
    taxEnabled: true,
  },
  analytics: withDefaults('analytics', {}),
  ceilings: withDefaults('ceilings', {}),
  landing: withDefaults('landing', {}),
  support: { supportEmail: 'support@llyner.test' },
};

/**
 * Demo data (PRD section 8a), called by scripts/seed.ts. Never in production. Saves every section
 * through the same use case Staff use (so secrets are sealed), once: sections already saved are
 * left alone, so the seed is idempotent and keeps changes made in the back office. Provider keys
 * are fake values; dev and test run the fake Tools (TOOLS_MODE=fake), so nothing calls a provider.
 */
export async function seed(deps: {
  db: Database;
  config: {
    NODE_ENV: 'development' | 'test' | 'production';
    SETTINGS_ENCRYPTION_KEY?: string | undefined;
  };
  clock: Clock;
  ids: IdGenerator;
  demo: { members: { staff: string }; businesses: { llynerInternal: string } };
}): Promise<void> {
  const secretBox = createSecretBox(deps.config);
  const settings = createSettingsReader({ db: deps.db, secretBox, clock: deps.clock });
  const uow = new KyselyUnitOfWork<SettingsRepos>(deps.db, (trx) => ({
    settings: new KyselySettingsRepository(trx),
    auditLog: new KyselyAuditLogRepository(trx),
  }));
  const update = new UpdateSettingsSection({
    uow,
    secretBox,
    reader: settings,
    clock: deps.clock,
    ids: deps.ids,
  });
  const existing = new Set(
    (await new KyselySettingsRepository(deps.db).findAll()).map((s) => s.section),
  );
  const seedActor = {
    memberId: deps.demo.members.staff,
    businessId: deps.demo.businesses.llynerInternal,
    roles: ['staff'] as const,
    emailVerified: true,
  };
  for (const section of SETTINGS_SECTIONS) {
    if (existing.has(section)) continue;
    await update.execute({ actor: seedActor, section, input: DEMO_SETTINGS[section] });
  }
}

/** Outbox events this module consumes, routed to its queues by the relay. */
export const platformSubscriptions: readonly OutboxSubscription[] = [];

/** This module's BullMQ workers, started by worker-registry.ts. */
export function registerPlatformWorkers(_deps: {
  db: Database;
  connection: Redis;
  logger: Logger;
}): Worker[] {
  return [];
}
