import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { StaffSupportDeskPage, StaffTicketPage } from '../index';

/** Mounts the two Staff pages the way the router will, with stand-ins for the pages they link to. */
export function renderStaff(path: string) {
  const router = createMemoryRouter(
    [
      { path: 'staff/support', element: <StaffSupportDeskPage /> },
      { path: 'staff/support/:number', element: <StaffTicketPage /> },
      { path: 'plans', element: <h1>Plans (customer app)</h1> },
      { path: 'staff/runs/:id', element: <h1>Run detail</h1> },
    ],
    { initialEntries: [path] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client };
}
