import type { RouteObject } from 'react-router';

export const routes: RouteObject[] = [
  {
    path: 'staff/tools',
    lazy: async () => ({ Component: (await import('./pages/tools-page')).ToolsPage }),
  },
];
