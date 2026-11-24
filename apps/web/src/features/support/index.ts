import type { RouteObject } from 'react-router';

/**
 * The support feature (prd-support): customer Help pages under /app/support and the Staff Support
 * desk under /app/staff/support (mounted in the Staff shell by app/router.tsx).
 */
export { useSupportWaitingCount } from './staff/api/hooks';

export const routes: RouteObject[] = [
  {
    path: 'support',
    lazy: async () => ({
      Component: (await import('./customer/pages/list-page')).CustomerSupportListPage,
    }),
  },
  {
    path: 'support/new',
    lazy: async () => ({
      Component: (await import('./customer/pages/new-page')).CustomerNewTicketPage,
    }),
  },
  {
    path: 'support/:number',
    lazy: async () => ({
      Component: (await import('./customer/pages/ticket-page')).CustomerTicketPage,
    }),
  },
  {
    path: 'staff/support',
    lazy: async () => ({
      Component: (await import('./staff/pages/desk-page')).StaffSupportDeskPage,
    }),
  },
  {
    path: 'staff/support/:number',
    lazy: async () => ({
      Component: (await import('./staff/pages/ticket-page')).StaffTicketPage,
    }),
  },
];
