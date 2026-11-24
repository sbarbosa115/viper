import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

// Every feature contributes MSW handlers in features/<x>/test/handlers.ts.
const modules = import.meta.glob<{ handlers?: Parameters<typeof setupServer> }>(
  '../features/*/test/handlers.ts',
  { eager: true },
);
const handlers = Object.values(modules).flatMap((m) => m.handlers ?? []);

export const server = setupServer(...handlers);

// jsdom has no layout, so window.scrollTo only logs "Not implemented"; make it a quiet no-op.
window.scrollTo = () => undefined;

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
