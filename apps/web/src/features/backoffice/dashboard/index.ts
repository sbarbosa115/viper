import type { RouteObject } from 'react-router';

export const routes: RouteObject[] = [
  {
    path: 'staff',
    lazy: async () => ({
      Component: (await import('./pages/dashboard-page')).DashboardPage,
    }),
  },
];
