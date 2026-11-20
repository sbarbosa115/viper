import type { RouteObject } from 'react-router';

/** The plans feature's routes, mounted under /app by app/router.tsx. */
export const routes: RouteObject[] = [
  {
    path: 'plans',
    lazy: async () => ({ Component: (await import('./pages/plans-page')).PlansPage }),
  },
  {
    path: 'plans/new',
    lazy: async () => ({ Component: (await import('./pages/new-plan-page')).NewPlanPage }),
  },
  {
    path: 'plans/:id',
    lazy: async () => ({ Component: (await import('./pages/plan-page')).PlanPage }),
  },
];
