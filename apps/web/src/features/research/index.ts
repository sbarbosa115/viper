import type { RouteObject } from 'react-router';

/** The research feature's routes, mounted under /app by app/router.tsx. */
export const routes: RouteObject[] = [
  {
    path: 'runs/:id',
    lazy: async () => ({ Component: (await import('./pages/run-page')).RunPage }),
  },
];
