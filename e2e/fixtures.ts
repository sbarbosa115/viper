import { test as base, expect } from '@playwright/test';

/** Shared fixtures for the acceptance specs; journeys add their own helpers here. */
export const test = base.extend<{ mailpitUrl: string }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures require a destructured first argument
  mailpitUrl: async ({}, use) => {
    await use(process.env.MAILPIT_URL ?? 'http://localhost:8025');
  },
});

export { expect };
