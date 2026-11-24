import type { RouteObject } from 'react-router';

/** The finance feature's routes, mounted under /app by app/router.tsx (Staff shell). */
export const routes: RouteObject[] = [
  {
    path: 'staff/expenses',
    lazy: async () => ({
      Component: (await import('./pages/expenses-page')).ExpensesPage,
    }),
  },
];
