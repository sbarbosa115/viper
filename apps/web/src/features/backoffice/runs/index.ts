import type { RouteObject } from 'react-router';

export const routes: RouteObject[] = [
  {
    path: 'staff/runs',
    lazy: async () => ({ Component: (await import('./pages/runs-page')).RunsPage }),
  },
  {
    path: 'staff/runs/:id',
    lazy: async () => ({ Component: (await import('./pages/run-detail-page')).RunDetailPage }),
  },
];
