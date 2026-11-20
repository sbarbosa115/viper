import { loadConfig } from '../../../config/env.js';
import { createDatabase } from '../../../shared/infrastructure/db/database.js';
import { SystemClock } from '../../../shared/infrastructure/time/system-clock.js';
import { Uuid7Generator } from '../../../shared/infrastructure/time/uuid7.js';
import { runStaffCommand, type StaffCommand } from '../index.js';

/**
 * Server commands (FR-5, PRD section 4):
 *   npm run staff:grant -w apps/api -- <email>
 *   npm run staff:revoke -w apps/api -- <email>
 *   npm run staff:reset-2fa -w apps/api -- <email>
 */
const commands: readonly StaffCommand[] = ['grant', 'revoke', 'reset-2fa'];
const [command, email] = process.argv.slice(2);

if (!commands.includes(command as StaffCommand) || !email) {
  console.error(`usage: staff.ts ${commands.join('|')} <email>`);
  process.exit(2);
}

const config = loadConfig();
const db = createDatabase(config.DATABASE_URL);
try {
  const message = await runStaffCommand(
    { db, clock: new SystemClock(), ids: new Uuid7Generator() },
    command as StaffCommand,
    email,
  );
  console.log(message);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
