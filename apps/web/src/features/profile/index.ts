import type { RouteObject } from 'react-router';

/** The profile feature's routes, mounted under /app by app/router.tsx. */
export const routes: RouteObject[] = [
  {
    path: 'profile',
    lazy: async () => ({ Component: (await import('./pages/profile-page')).ProfilePage }),
  },
];
