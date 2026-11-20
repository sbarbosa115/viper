import type { RouteObject } from 'react-router';

export const routes: RouteObject[] = [
  {
    path: 'staff/flows',
    lazy: async () => ({ Component: (await import('./pages/flows-page')).FlowsPage }),
  },
];
