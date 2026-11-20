import { createBrowserRouter, type RouteObject } from 'react-router';
import { routes as assistantRoutes } from '../features/assistant';
import { routes as authRoutes } from '../features/auth';
import { routes as backofficeRoutes } from '../features/backoffice';
import { routes as creditsRoutes } from '../features/credits';
import { routes as leadsRoutes } from '../features/leads';
import { routes as legalRoutes } from '../features/legal';
import { routes as plansRoutes } from '../features/plans';
import { routes as profileRoutes } from '../features/profile';
import { routes as researchRoutes } from '../features/research';
import { AuthLayout } from './auth-layout';
import { CustomerShell } from './customer-shell';
import { RedirectIfSignedIn, RequireAuth, RequireStaff } from './guards';
import { KitPage } from './kit-page';
import { NotFoundPage } from './pages/not-found';
import { placeholderRoute, placeholders, type RouteGroup } from './placeholders';
import { StaffShell } from './staff-shell';

const featureRoutes: RouteObject[] = [
  ...authRoutes,
  ...assistantRoutes,
  ...profileRoutes,
  ...plansRoutes,
  ...researchRoutes,
  ...leadsRoutes,
  ...creditsRoutes,
  ...backofficeRoutes,
  ...legalRoutes,
];

const guestOnly = new Set(['signup', 'login']);
const authPaths = new Set(['signup', 'login', 'verify-email', 'forgot-password', 'reset-password']);

/** Where a feature route belongs, from its path relative to /app. */
function groupOf(route: RouteObject): RouteGroup {
  const path = route.path ?? '';
  if (path === 'staff' || path.startsWith('staff/')) return 'staff';
  if (guestOnly.has(path)) return 'guest-auth';
  if (authPaths.has(path.split('/')[0] ?? '') || path === 'login/two-factor') return 'auth';
  return 'customer';
}

const keyOf = (route: RouteObject) => (route.index ? '' : (route.path ?? '*'));

/** Placeholders not yet replaced by a feature route (used by tests). */
export function remainingPlaceholders() {
  const taken = new Set(featureRoutes.map(keyOf));
  return placeholders.filter((p) => !taken.has(p.path));
}

/** Feature routes first; a placeholder is added only for paths no feature provides. */
function routesFor(group: RouteGroup): RouteObject[] {
  const own = featureRoutes.filter((r) => groupOf(r) === group);
  const taken = new Set(featureRoutes.map(keyOf));
  const fill = placeholders
    .filter((p) => p.group === group && !taken.has(p.path))
    .map(placeholderRoute);
  return [...own, ...fill];
}

export function buildRoutes(): RouteObject[] {
  return [
    {
      element: <AuthLayout />,
      children: [
        { element: <RedirectIfSignedIn />, children: routesFor('guest-auth') },
        ...routesFor('auth'),
      ],
    },
    {
      element: <RequireAuth />,
      children: [
        { element: <CustomerShell />, children: routesFor('customer') },
        {
          element: <RequireStaff />,
          children: [{ element: <StaffShell />, children: routesFor('staff') }],
        },
      ],
    },
    // Dev-only component gallery for wave demos; not linked from anywhere.
    ...(import.meta.env.DEV ? [{ path: '__kit', element: <KitPage /> }] : []),
    { path: '*', element: <NotFoundPage /> },
  ];
}

export const routes: RouteObject[] = buildRoutes();

/** All SPA routes live under /app (the Vite base), so the router basename is /app. */
export function createAppRouter() {
  return createBrowserRouter(routes, { basename: '/app' });
}
