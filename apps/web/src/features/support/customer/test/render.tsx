import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider, useLocation, useParams } from 'react-router';
import { ToastProvider } from '../../../../shared/ui';
import { CustomerNewTicketPage, CustomerSupportListPage, CustomerTicketPage } from '../index';

function Stub({ name }: { name: string }) {
  const { id } = useParams();
  return <p>{`${name}${id ? ` ${id}` : ''}`}</p>;
}

function Layout() {
  const location = useLocation();
  return (
    <>
      <Outlet />
      <output data-testid="location">{location.pathname + location.search}</output>
    </>
  );
}

/** The customer support routes the way the router mounts them (under /app), plus run stubs. */
export function renderSupport(path: string) {
  const router = createMemoryRouter(
    [
      {
        element: <Layout />,
        children: [
          { path: 'support', element: <CustomerSupportListPage /> },
          { path: 'support/new', element: <CustomerNewTicketPage /> },
          { path: 'support/:number', element: <CustomerTicketPage /> },
          { path: 'runs/:id', element: <Stub name="Run page" /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { router, client };
}
