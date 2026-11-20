import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { Config } from './config/env.js';
import { registerOriginCheck } from './modules/identity/index.js';
import { registerAuditTrail, type AuditRecorder } from './modules/platform/index.js';
import { siteRoutes, type SiteDeps } from './site/site.routes.js';
import type { AnalyticsTracker } from './shared/application/analytics-tracker.js';
import type { EmailSender } from './shared/application/email-sender.js';
import type { Features } from './shared/application/features.js';
import type { Clock } from './shared/domain/clock.js';
import type { IdGenerator } from './shared/domain/id-generator.js';
import { registerActor, type ResolveActor } from './shared/http/actor-plugin.js';
import { registerErrorHandling } from './shared/http/error-handler.js';
import { healthRoutes, type HealthProbes } from './shared/http/health.routes.js';

export interface AppDeps {
  logger: FastifyBaseLogger | false;
  clock: Clock;
  ids: IdGenerator;
  analytics: AnalyticsTracker;
  email: EmailSender;
  features: Features;
  /** Named dependency checks for GET /api/health, e.g. database and cache. */
  health: HealthProbes;
  /** Resolves the signed-in Actor; the identity module provides it. Absent means anonymous. */
  resolveActor?: ResolveActor;
  /** platform's Audit log: records every write made while Acting as (FR-6, FR-7). */
  auditTrail?: AuditRecorder;
  /** The public site's collaborators (FR-33 to FR-35); absent serves the placeholder page. */
  site?: SiteDeps;
}

export interface BuildAppOptions {
  /**
   * CSRF Origin check on every state-changing /api request (ADR 0004). On by default; module
   * HTTP tests built with buildTestApp turn it off unless they ask for it.
   */
  originCheck?: boolean;
}

/** A bounded context's HTTP entry point, registered under the /api prefix (see composition.ts). */
export interface AppModule {
  readonly name: string;
  register(app: FastifyInstance, deps: AppDeps): void | Promise<void>;
}

export async function buildApp(
  config: Config,
  deps: AppDeps,
  modules: readonly AppModule[] = [],
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify(
    deps.logger
      ? { loggerInstance: deps.logger, trustProxy: true }
      : { logger: false, trustProxy: true },
  );
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandling(app);
  registerActor(app, deps.resolveActor);
  if (deps.auditTrail) registerAuditTrail(app, { audit: deps.auditTrail });

  await app.register(helmet);
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  if (config.NODE_ENV !== 'production') {
    await app.register(swagger, {
      openapi: { info: { title: 'Viper API', version: '0.0.0' } },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/api/docs' });
  }

  await app.register(siteRoutes, deps.site ? { site: deps.site } : {});

  await app.register(
    async (api) => {
      // Skips GET/HEAD/OPTIONS and the Stripe webhook (signature-checked instead).
      if (options.originCheck ?? true) registerOriginCheck(api, { appUrl: config.APP_URL });
      healthRoutes(api, deps.health);
      for (const module of modules) {
        await api.register(async (scoped) => module.register(scoped, deps));
      }
    },
    { prefix: '/api' },
  );

  return app;
}
