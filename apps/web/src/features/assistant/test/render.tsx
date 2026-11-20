import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router';
import { routes } from '../index';

function Page({ name }: { name: string }) {
  const { id } = useParams();
  return <p>{`${name}${id ? ` ${id}` : ''}`}</p>;
}

export function renderAssistant(path = '/chat') {
  const router = createMemoryRouter(
    [
      ...routes,
      { path: 'plans', element: <Page name="Plans page" /> },
      { path: 'plans/:id', element: <Page name="Plan page" /> },
      { path: 'profile', element: <Page name="Profile page" /> },
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
