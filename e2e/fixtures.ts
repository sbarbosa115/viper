import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

/** The fixed demo password of every seeded account (PRD section 8a). */
export const demoPassword = 'demo1234';

/** The origin the app sees requests from; state-changing API calls must send it as `Origin`. */
export const appOrigin = (): string =>
  new URL(process.env.BASE_URL ?? 'http://localhost:5173').origin;

interface Fixtures {
  mailpitUrl: string;
  /** Signs a seeded, verified Member in through the log-in form (no Staff two-factor). */
  loginAs: (email: string, password?: string) => Promise<void>;
}

/** Shared fixtures for the acceptance specs; journeys add their own helpers here. */
export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures require a destructured first argument
  mailpitUrl: async ({}, use) => {
    await use(process.env.MAILPIT_URL ?? 'http://localhost:8025');
  },
  loginAs: async ({ page }, use) => {
    await use(async (email, password = demoPassword) => {
      await page.goto('/app/login');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Log in' }).click();
      // Home is the welcome chat (/app) or, once the profile is complete, Plans (/app/plans).
      await expect(page).toHaveURL(/\/app(\/plans)?\/?$/);
    });
  },
});

/** Fulfils a fake Stripe Checkout session like the webhook would (test hook, e2e only). */
export async function completeFakeCheckout(
  request: APIRequestContext,
  sessionId: string,
): Promise<void> {
  const res = await request.post(`/api/test/stripe/complete/${sessionId}`, {
    headers: { Origin: appOrigin() },
  });
  expect(res.ok(), `complete ${sessionId}: ${res.status()}`).toBe(true);
  expect(await res.json()).toEqual({ fulfilled: true });
}

/** Available credits as the API reports them for the signed-in Member's Business. */
export async function availableCredits(page: Page): Promise<number> {
  const res = await page.request.get('/api/credits');
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { available: number }).available;
}

export { expect };
