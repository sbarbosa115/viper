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
import { assistantModule } from './modules/assistant/index.js';
import { billingModule } from './modules/billing/index.js';
import { identityModule } from './modules/identity/index.js';
import { leadsModule } from './modules/leads/index.js';
import { planningModule } from './modules/planning/index.js';
import { platformModule } from './modules/platform/index.js';
import { profileModule } from './modules/profile/index.js';
import { reportingModule } from './modules/reporting/index.js';
import { researchModule } from './modules/research/index.js';
import { toolsModule } from './modules/tools/index.js';
import { siteRoutes } from './site/site.routes.js';
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
}

/** A bounded context's HTTP entry point, registered under the /api prefix. */
export interface AppModule {
  readonly name: string;
  register(app: FastifyInstance, deps: AppDeps): void | Promise<void>;
}

/** Every bounded context's HTTP module, as main.ts registers them. */
export const appModules: readonly AppModule[] = [
  identityModule,
  platformModule,
  billingModule,
  profileModule,
  assistantModule,
  planningModule,
  researchModule,
  toolsModule,
  leadsModule,
  reportingModule,
];

export async function buildApp(
  config: Config,
  deps: AppDeps,
  modules: readonly AppModule[] = [],
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

  await app.register(siteRoutes);

  await app.register(
    async (api) => {
      healthRoutes(api, deps.health);
      for (const module of modules) {
        await api.register(async (scoped) => module.register(scoped, deps));
      }
    },
    { prefix: '/api' },
  );

  return app;
}
