import { handlers as audit } from '../audit/test/handlers';
import { handlers as customers } from '../customers/test/handlers';
import { handlers as dashboard } from '../dashboard/test/handlers';
import { handlers as flows } from '../flows/test/handlers';
import { handlers as packs } from '../packs/test/handlers';
import { handlers as runs } from '../runs/test/handlers';
import { handlers as settings } from '../settings/test/handlers';
import { handlers as tools } from '../tools/test/handlers';

/**
 * The back office's sub-features keep their own handlers; test/setup.ts loads only
 * features/<x>/test/handlers.ts, so this file collects them for the shared MSW server.
 */
export const handlers = [
  ...settings,
  ...audit,
  ...packs,
  ...dashboard,
  ...customers,
  ...runs,
  ...tools,
  ...flows,
];
