import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider, useLocation, useParams } from 'react-router';
import { ToastProvider } from '../../../shared/ui';
import { routes } from '../index';

function Stub({ name }: { name: string }) {
  const { id } = useParams();
  return <p>{`${name}${id ? ` ${id}` : ''}`}</p>;
}

function Layout() {
  return (
    <>
      <Outlet />
      <output data-testid="location">{useLocation().pathname}</output>
    </>
  );
}

/** The plans routes, plus stubs for pages other features own (runs, leads, credits, chat). */
export function renderPlans(path = '/plans') {
  const router = createMemoryRouter(
    [
      {
        element: <Layout />,
        children: [
          ...routes,
          { path: 'runs/:id', element: <Stub name="Run page" /> },
          { path: 'plans/:id/leads', element: <Stub name="Leads page" /> },
          { path: 'credits', element: <Stub name="Credits page" /> },
          { path: 'chat', element: <Stub name="Chat page" /> },
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
