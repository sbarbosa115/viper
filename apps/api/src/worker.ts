import * as Sentry from '@sentry/node';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { loadConfig } from './config/env.js';
import { createDatabase } from './shared/infrastructure/db/database.js';
import { registerWorkers, stopWorkers } from './worker-registry.js';

const HEARTBEAT_MS = 30_000;
const HEARTBEAT_KEY = 'worker:heartbeat';

const config = loadConfig();
if (config.SENTRY_DSN) Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });
const logger = pino({ level: config.NODE_ENV === 'development' ? 'debug' : 'info' });

const db = createDatabase(config.DATABASE_URL);
// BullMQ requires maxRetriesPerRequest: null on its connection.
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', (err: Error) => logger.warn({ err }, 'valkey connection error'));

const registered = registerWorkers({ config, db, connection, logger });
const { workers } = registered;

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

/** App Platform sends SIGKILL 30 s after SIGTERM: stop within about 25 s. */
const SHUTDOWN_DEADLINE_MS = 25_000;
/** After this, workers still busy are force-closed (their leases expire; the sweeper resumes). */
const CLOSE_WAIT_MS = 20_000;
let stopping = false;

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'worker shutting down');
  setTimeout(() => {
    logger.error('worker shutdown overran its deadline; exiting');
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS).unref();
  clearInterval(timer);
  // Closing the research-runs worker aborts the attempts in flight: each stops at its next save
  // (or after a 10 s grace for a Tool call in flight), releases its lease and ends as a retryable
  // `worker_stopped`. The SMTP pool closes after the workers, so a run email is not cut off.
  await stopWorkers(registered, { closeWaitMs: CLOSE_WAIT_MS, logger });
  await db.destroy();
  connection.disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info({ workers: workers.length }, 'worker started');
