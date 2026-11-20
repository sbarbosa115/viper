import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const PASSWORD = 'Honey-Bun-4-Breakfast!';
const headline = 'Find the businesses most likely to buy what you sell.';

function uniqueEmail(tag: string): string {
  return `sam-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aj8.test`;
}

const signupPanel = (page: Page) => page.getByRole('tabpanel', { name: 'Create account' });
const loginPanel = (page: Page) => page.getByRole('tabpanel', { name: 'Log in' });

async function fillCreateAccount(page: Page, email: string): Promise<void> {
  const panel = signupPanel(page);
  await panel.getByLabel('Business name').fill('Sweet Supply Co');
  await panel.getByLabel('Your name').fill('Sam');
  await panel.getByLabel('Work email').fill(email);
  await panel.getByLabel('Password').fill(PASSWORD);
  await panel.getByRole('button', { name: 'Create account' }).click();
}

async function logOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/app\/login/);
}

test.describe('AJ-8: from the landing page to the welcome chat', () => {
  test('AJ-8: sign up and log in from the landing card (JavaScript on) @journey', async ({
    page,
  }) => {
    const email = uniqueEmail('js');

    // 1. Open / and check the pricing shows the three packs.
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: headline })).toBeVisible();
    const pricing = page.locator('#pricing');
    for (const [name, price] of [
      ['Starter', '$25'],
      ['Growth', '$100'],
      ['Pro', '$250'],
    ] as const) {
      await expect(pricing.getByRole('listitem').filter({ hasText: name })).toContainText(price);
    }

    // 2. Fill the Create account tab and submit.
    await expect(page.getByRole('tab', { name: 'Create account' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await fillCreateAccount(page, email);

    // 3. Land on /app with the welcome chat and the verify-email notice.
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 20_000 });
    await expect(page.getByText('Verify your email to get 50 free credits')).toBeVisible();

    // 4. Log out; open /, use the Log in tab with the same email.
    await logOut(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/$/); // switched in place, no navigation
    await loginPanel(page).getByLabel('Email').fill(email);
    await loginPanel(page).getByLabel('Password').fill(PASSWORD);
    await loginPanel(page).getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/app(\/plans)?\/?$/, { timeout: 20_000 });

    // Signed in, the landing page offers the app instead of the card.
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Open the app' }).first()).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Create account' })).toHaveCount(0);

    // Expected: the email-taken case switches tabs, with the email filled in.
    await page.context().clearCookies();
    await page.goto('/');
    await fillCreateAccount(page, email);
    await expect(page.getByRole('tab', { name: 'Log in' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(loginPanel(page)).toBeVisible();
    await expect(loginPanel(page).getByLabel('Email')).toHaveValue(email);
    await expect(loginPanel(page).getByRole('alert')).toHaveText(
      'You already have an account. Log in instead.',
    );
    await expect(page).toHaveURL(/\/$/);
  });

  test('NFR-10: the landing page loads fast and stable on a phone', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    // Browser-side code as strings: the e2e project has no DOM types.
    await page.addInitScript({
      content: `
        window.__lcp = 0; window.__cls = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.__lcp = e.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
      `,
    });
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const vitals = await page.evaluate<{
      lcp: number;
      cls: number;
      ttfb: number;
      load: number;
    }>(`(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return { lcp: window.__lcp, cls: window.__cls, ttfb: nav.responseStart, load: nav.loadEventEnd };
    })()`);
    test.info().annotations.push({ type: 'web-vitals', description: JSON.stringify(vitals) });
    console.log(`NFR-10 web vitals (390×844, no throttling): ${JSON.stringify(vitals)}`);
    expect(vitals.lcp).toBeGreaterThan(0);
    expect(vitals.lcp).toBeLessThan(2500);
    expect(vitals.cls).toBeLessThan(0.1);
    // No horizontal scroll at phone width.
    const overflow = await page.evaluate<number>(
      'document.documentElement.scrollWidth - document.documentElement.clientWidth',
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
});

test.describe('AJ-8 without JavaScript (FR-35)', () => {
  test.use({ javaScriptEnabled: false });

  test('AJ-8: the no-JS card signs up into /app, and an used email opens Log in', async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail('nojs');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: headline })).toBeVisible();
    await expect(page.locator('#pricing')).toContainText('$100');

    await fillCreateAccount(page, email);
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 20_000 });
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'sid')?.httpOnly).toBe(true);

    // The SPA needs JavaScript: open the same session with it on to see the welcome chat.
    const withJs = await browser.newContext({
      javaScriptEnabled: true,
      storageState: await page.context().storageState(),
    });
    const app = await withJs.newPage();
    await app.goto('/app');
    await expect(app.getByText('Verify your email to get 50 free credits')).toBeVisible({
      timeout: 20_000,
    });
    await withJs.close();

    // The same email again, still without JavaScript: the Log in tab, email filled in.
    await page.context().clearCookies();
    await page.goto('/');
    await fillCreateAccount(page, email);
    await expect(page.getByRole('tab', { name: 'Log in' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(loginPanel(page).getByLabel('Email')).toHaveValue(email);
    await expect(loginPanel(page)).toContainText('You already have an account. Log in instead.');

    // And the no-JS Log in tab signs in.
    await loginPanel(page).getByLabel('Password').fill(PASSWORD);
    await loginPanel(page).getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 20_000 });
  });
});
