import { availableCredits, completeFakeCheckout, expect, test } from './fixtures.js';

test('AJ-3: Sam buys the Starter pack and sees +2,500 credits and a ledger entry', async ({
  page,
  loginAs,
}) => {
  await loginAs('owner@demo.test');
  await page.goto('/app/credits');
  const before = await availableCredits(page);

  // 1. Click "Buy" on Starter. The fake gateway sends the browser straight back.
  await page.getByRole('button', { name: 'Buy Starter' }).click();

  // 2. The fake Stripe Checkout completes and the webhook fires.
  await page.waitForURL(/\/app\/credits\?purchase=success&fake_session=/);
  const sessionId = new URL(page.url()).searchParams.get('fake_session');
  expect(sessionId).toBeTruthy();
  // The page remembers the balance it first loaded; let it load before the webhook lands.
  await expect(page.getByText('Payment received, adding your credits…')).toBeVisible();
  await expect(page.getByText('Available', { exact: true })).toBeVisible();
  await completeFakeCheckout(page.request, sessionId ?? '');

  // 3. Back on /app/credits?purchase=success the page picks the purchase up.
  await expect(page.getByText('Your credits were added.')).toBeVisible({ timeout: 20_000 });
  expect(await availableCredits(page)).toBe(before + 2500);

  const available = page.getByText('Available', { exact: true }).locator('xpath=..');
  await expect(available).toContainText((before + 2500).toLocaleString('en-US'));
  const entry = page.getByRole('row', { name: /Starter pack/ }).first();
  await expect(entry).toBeVisible();
  await expect(entry).toContainText('+2,500');
});
