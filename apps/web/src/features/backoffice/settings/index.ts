import type { RouteObject } from 'react-router';

export const routes: RouteObject[] = [
  {
    path: 'staff/settings',
    lazy: async () => ({ Component: (await import('./pages/settings-page')).SettingsPage }),
  },
];
