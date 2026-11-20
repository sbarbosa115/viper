import type { RouteObject } from 'react-router';

export const routes: RouteObject[] = [
  {
    path: 'staff/packs',
    lazy: async () => ({ Component: (await import('./pages/packs-page')).PacksPage }),
  },
];
