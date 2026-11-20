import type { RouteObject } from 'react-router';

/** The assistant feature's routes, mounted under /app by app/router.tsx. */
export const routes: RouteObject[] = [
  {
    index: true,
    lazy: async () => ({ Component: (await import('./pages/home-page')).HomePage }),
  },
  {
    path: 'chat',
    lazy: async () => ({ Component: (await import('./pages/chat-page')).ChatPage }),
  },
];
