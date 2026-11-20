import type { RouteObject } from 'react-router';

/** The leads feature's routes, mounted under /app by app/router.tsx. */
export const routes: RouteObject[] = [
  {
    path: 'leads',
    lazy: async () => ({ Component: (await import('./pages/leads-index-page')).LeadsIndexPage }),
  },
  {
    path: 'plans/:id/leads',
    lazy: async () => ({ Component: (await import('./pages/leads-page')).LeadsPage }),
  },
  {
    path: 'leads/:id',
    lazy: async () => ({ Component: (await import('./pages/lead-detail-page')).LeadDetailPage }),
  },
];
