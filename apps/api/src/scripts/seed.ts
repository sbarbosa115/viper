import { pino } from 'pino';
import { createTotpCipher } from '../composition.js';
import { loadConfig } from '../config/env.js';
import * as assistant from '../modules/assistant/index.js';
import * as billing from '../modules/billing/index.js';
import * as finance from '../modules/finance/index.js';
import * as identity from '../modules/identity/index.js';
import * as leads from '../modules/leads/index.js';
import * as planning from '../modules/planning/index.js';
import * as platform from '../modules/platform/index.js';
import * as profile from '../modules/profile/index.js';
import * as research from '../modules/research/index.js';
import * as tools from '../modules/tools/index.js';
import { createDatabase } from '../shared/infrastructure/db/database.js';
import { SystemClock } from '../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../shared/infrastructure/time/uuid7.js';

/**
 * Demo seed (PRD section 8a): `./dev seed`. Every module seeds its own data through its own use
 * cases, in dependency order, and must be idempotent (running the seed twice changes nothing).
 * Refuses to run in production; production gets only reference data through the release steps.
 */
const config = loadConfig();
if (config.NODE_ENV === 'production') {
  throw new Error('Refusing to seed: NODE_ENV=production');
}

const id = (n: number) => `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

/**
 * Fixed ids for demo records that other modules reference. Modules don't share foreign keys,
 * so a module can write a reference before its owner seeds the record (research seeds the demo
 * run of a Plan that planning creates later).
 */
const demo = {
  businesses: {
    sweetSupply: id(0xd001),
    cleanDesk: id(0xd002),
    cornerCoffee: id(0xd003),
    llynerInternal: id(0xd004),
  },
  members: {
    owner: id(0xd101),
    newOwner: id(0xd102),
    lowOwner: id(0xd103),
    staff: id(0xd104),
  },
  products: {
    caneSugar: id(0xd201),
    powderedSugar: id(0xd202),
    espressoBeans: id(0xd203),
    brownSugar: id(0xd204),
  },
  plans: { bakeriesNearAustin: id(0xd301), cornerCafes: id(0xd302) },
  runs: { bakeriesNearAustin: id(0xd401) },
  password: 'demo1234',
  staffTotpSecret: 'JBSWY3DPEHPK3PXP',
} as const;

const logger = pino({ level: 'info' });
const db = createDatabase(config.DATABASE_URL);
const deps = {
  config,
  db,
  logger,
  clock: new SystemClock(),
  ids: new Uuid7Generator(),
  demo,
  // Seals the Staff demo account's TOTP secret the way platform seals settings (ADR 0012).
  cipher: createTotpCipher(platform.createSecretBox(config)),
};

/**
 * identity: owner@demo.test (Sweet Supply Co), new@demo.test (Clean Desk Co), low@demo.test
 *   (Corner Coffee Roasters), staff@demo.test (Staff, "Llyner Leads (internal)" marked internal,
 *   TOTP secret JBSWY3DPEHPK3PXP); all verified, password demo1234.
 * platform: Platform settings (SMTP → Mailpit, fake provider keys, default models and ceilings).
 * billing: Credit packs Starter/Growth/Pro; wallets: Sweet Supply 863, Clean Desk 50, Corner 120;
 *   paid November 2026 purchases $49 + $49 + $99 (prd-expenses 8a).
 * tools: the Tool catalog with the seeded Rate card; November 2026 metered Tool calls.
 * finance: November 2026 bills, the One-off legal review, Provider invoices, the $300 Budget and
 *   its 80% and 100% alerts (prd-expenses 8a; the P&L shows net −$325.75).
 * research: Flow template "Local buyers" v1 and the completed demo run of "Bakeries near Austin".
 * profile: complete profiles for Sweet Supply Co and Corner Coffee Roasters; Clean Desk empty.
 * planning: "Bakeries near Austin" (Sweet Supply Co) and one Plan for Corner Coffee Roasters.
 * leads: 25 Leads for the demo run from the fake-Tool fixtures, Feedback on 5.
 * assistant and reporting have no demo data (assistant's seed is a no-op kept for symmetry).
 */
const steps = [
  ['identity', identity.seed],
  ['platform', platform.seed],
  ['billing', billing.seed],
  ['tools', tools.seed],
  ['finance', finance.seed],
  ['research', research.seed],
  ['profile', profile.seed],
  ['planning', planning.seed],
  ['leads', leads.seed],
  ['assistant', assistant.seed],
] as const;

try {
  for (const [name, seed] of steps) {
    logger.info({ module: name }, 'seeding');
    await seed(deps);
  }
  logger.info('seed complete');
} finally {
  await db.destroy();
}
