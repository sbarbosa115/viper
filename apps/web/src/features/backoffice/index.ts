import type { RouteObject } from 'react-router';
import { routes as audit } from './audit';
import { routes as customers } from './customers';
import { routes as dashboard } from './dashboard';
import { routes as flows } from './flows';
import { routes as packs } from './packs';
import { routes as runs } from './runs';
import { routes as settings } from './settings';
import { routes as tools } from './tools';

/** The backoffice feature's routes, mounted under /app by app/router.tsx (Staff shell). */
export const routes: RouteObject[] = [
  ...dashboard,
  ...customers,
  ...runs,
  ...tools,
  ...flows,
  ...settings,
  ...audit,
  ...packs,
];
