import type { RouteObject } from 'react-router';

export const routes: RouteObject[] = [
  {
    path: 'staff/audit-log',
    lazy: async () => ({ Component: (await import('./pages/audit-page')).AuditPage }),
  },
];
