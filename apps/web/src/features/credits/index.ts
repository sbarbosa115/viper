import type { RouteObject } from 'react-router';

/** The credits feature's routes, mounted under /app by app/router.tsx. */
export const routes: RouteObject[] = [
  {
    path: 'credits',
    lazy: async () => ({ Component: (await import('./pages/credits-page')).CreditsPage }),
  },
];
