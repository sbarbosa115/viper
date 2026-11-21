import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../index';

/** Renders the finance route the way the router mounts it, with a fresh query cache. */
export function renderFinance(search = '') {
  const router = createMemoryRouter(routes, { initialEntries: [`/staff/expenses${search}`] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client };
}
