import type { RouteObject } from 'react-router';

export const routes: RouteObject[] = [
  {
    path: 'staff/customers',
    lazy: async () => ({
      Component: (await import('./pages/customers-page')).CustomersPage,
    }),
  },
];
