import { me as meExample } from '@app/contracts/examples';
import type { Me } from '@app/contracts/identity';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import { CreditsPage } from '../pages/credits-page';
import { routes } from '../index';

/** A handler answering GET /api/auth/me with this Member (the page reads Acting as and verification). */
export const meHandler = (me: Me = meExample) =>
  http.get('*/api/auth/me', () => HttpResponse.json(me));

export function renderCredits(path = '/credits') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client };
}

/** The page without the lazy route, for tests that run on fake timers. */
export function renderCreditsPage(path = '/credits') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <CreditsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
