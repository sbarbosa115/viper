import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps, type AppModule } from '../src/app.js';
import type { Config } from '../src/config/env.js';
import type { Actor } from '../src/shared/domain/actor.js';
import { RecordingAnalyticsTracker } from '../src/shared/infrastructure/analytics/db-analytics-tracker.js';
import { InMemoryEmailSender } from '../src/shared/infrastructure/email/in-memory-email-sender.js';
import { StaticFeatures } from '../src/shared/infrastructure/features/env-features.js';
import { FixedClock } from '../src/shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../src/shared/infrastructure/time/uuid7.js';

export const testConfig: Config = {
  NODE_ENV: 'test',
  PORT: 0,
  DATABASE_URL: 'mysql://root:test@localhost:3306/app_test',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'test-session-secret-test-session-secret',
  APP_URL: 'http://localhost:5173',
  TOOLS_MODE: 'fake',
  ENABLE_TEST_HOOKS: false,
};

export type TestDeps = AppDeps & {
  analytics: RecordingAnalyticsTracker;
  email: InMemoryEmailSender;
  clock: FixedClock;
};

export interface BuildTestAppOptions {
  modules?: readonly AppModule[];
  deps?: Partial<AppDeps>;
  /** Installs a stub for authentication. Omit it to test 401 responses. */
  actor?: Actor;
  /** Turns on the /api Origin check (CSRF, ADR 0004) that main.ts always has. Off by default. */
  originCheck?: boolean;
}

export function defaultTestDeps(): TestDeps {
  return {
    logger: false,
    clock: new FixedClock(new Date('2026-01-01T00:00:00.000Z')),
    ids: new SequentialIdGenerator(),
    analytics: new RecordingAnalyticsTracker(),
    email: new InMemoryEmailSender(),
    features: new StaticFeatures(),
    health: {},
  };
}

/** Never reads process.env. Returns the app and the fakes it was built with. */
export async function buildTestApp(
  options: BuildTestAppOptions = {},
): Promise<FastifyInstance & { testDeps: TestDeps }> {
  const testDeps: TestDeps = {
    ...defaultTestDeps(),
    ...options.deps,
    ...(options.actor ? { resolveActor: () => options.actor ?? null } : {}),
  } as TestDeps;
  const app = await buildApp(testConfig, testDeps, options.modules ?? [], {
    originCheck: options.originCheck ?? false,
  });
  await app.ready();
  return Object.assign(app, { testDeps });
}
