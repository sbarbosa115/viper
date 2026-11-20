import * as Sentry from '@sentry/node';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { loadConfig } from './config/env.js';
import { createDatabase } from './shared/infrastructure/db/database.js';
import { registerWorkers } from './worker-registry.js';

const HEARTBEAT_MS = 30_000;
const HEARTBEAT_KEY = 'worker:heartbeat';

const config = loadConfig();
if (config.SENTRY_DSN) Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });
const logger = pino({ level: config.NODE_ENV === 'development' ? 'debug' : 'info' });

const db = createDatabase(config.DATABASE_URL);
// BullMQ requires maxRetriesPerRequest: null on its connection.
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', (err: Error) => logger.warn({ err }, 'valkey connection error'));

const workers = registerWorkers({ config, db, connection, logger });

async function heartbeat(): Promise<void> {
  const at = new Date().toISOString();
  try {
    await connection.set(HEARTBEAT_KEY, at, 'EX', (HEARTBEAT_MS * 3) / 1000);
    logger.info({ workers: workers.length, at }, 'worker heartbeat');
  } catch (err) {
    logger.warn({ err }, 'worker heartbeat failed');
  }
}

await heartbeat();
const timer = setInterval(() => void heartbeat(), HEARTBEAT_MS);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'worker shutting down');
  clearInterval(timer);
  await Promise.all(workers.map((w) => w.close()));
  await db.destroy();
  connection.disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info({ workers: workers.length }, 'worker started');
