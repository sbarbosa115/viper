import * as Sentry from '@sentry/node';
import { Redis } from 'ioredis';
import { sql } from 'kysely';
import { pino } from 'pino';
import { buildApp } from './app.js';
import { composeApp } from './composition.js';
import { loadConfig } from './config/env.js';
import { createDatabase } from './shared/infrastructure/db/database.js';
import { EnvFeatures } from './shared/infrastructure/features/env-features.js';

const config = loadConfig();
const logger = pino({ level: config.NODE_ENV === 'development' ? 'debug' : 'info' });

// Error tracking only when a DSN is configured (stack.md).
if (config.SENTRY_DSN) {
  Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });
}

const db = createDatabase(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1 });
redis.on('error', (err: Error) => logger.warn({ err }, 'valkey connection error'));

const composed = composeApp(config, {
  db,
  logger,
  redis,
  features: new EnvFeatures(process.env),
  health: {
    database: () => sql`SELECT 1`.execute(db),
    cache: () => redis.ping(),
  },
});
const app = await buildApp(config, composed.deps, composed.modules);
if (config.SENTRY_DSN) Sentry.setupFastifyErrorHandler(app);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  await app.close();
  composed.close();
  await db.destroy();
  redis.disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: config.PORT });
