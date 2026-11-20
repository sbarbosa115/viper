import type { RouteObject } from 'react-router';
import { routes as audit } from './audit';
import { routes as packs } from './packs';
import { routes as settings } from './settings';

/** The backoffice feature's routes, mounted under /app by app/router.tsx (Staff shell). */
export const routes: RouteObject[] = [...settings, ...audit, ...packs];
