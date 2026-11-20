import { appOrigin, expect, test } from './fixtures.js';
import { loginAsStaff } from './journeys.js';

const business = 'Sweet Supply Co';

test('AJ-6: Staff sign in with TOTP, act as a customer and stop @journey', async ({ page }) => {
  // The sign-in may wait for a TOTP window no earlier journey has used.
  test.setTimeout(90_000);
  // 1. Log in as staff@demo.test and enter the TOTP code (seeded secret).
  await loginAsStaff(page);

  // 2. The /app/staff dashboard shows tiles.
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  for (const tile of ['Customers', 'Revenue & credits', 'Runs', 'Leads']) {
    await expect(main.getByRole('heading', { name: tile, exact: true })).toBeVisible();
  }

  // 3. Customers → search "Sweet" → Act as (the seeded Sweet Supply Co, owner@demo.test).
  await page
    .getByRole('navigation', { name: 'Back office navigation' })
    .getByRole('link', { name: 'Customers' })
    .click();
  await expect(page).toHaveURL(/\/app\/staff\/customers$/);
  await page.getByLabel('Search').fill('Sweet');
  const row = page.getByRole('row').filter({ hasText: 'owner@demo.test' });
  await expect(row).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: 'new@demo.test' })).toHaveCount(0);
  await row.getByRole('button', { name: `Act as ${business}` }).click();

  // 4. The app shows Sweet Supply Co's Plans and Leads.
  await expect(page).toHaveURL(/\/app\/plans$/);
  await expect(
    page
      .getByRole('main')
      .getByRole('link', { name: /Bakeries near Austin/ })
      .first(),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Leads', exact: true })
    .click();
  // The seeded "Bakeries near Austin" and its 25 Leads.
  await expect(page).toHaveURL(/\/app\/plans\/00000000-0000-7000-8000-00000000d301\/leads/);
  await expect(
    page.getByRole('list', { name: 'Lead list' }).getByRole('listitem').first(),
  ).toBeVisible();

  // Trying to buy credits is blocked.
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Credits', exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/credits$/);
  await expect(
    page.getByText(
      `You are acting as ${business}. Buying credits is only available from the Owner’s own account.`,
    ),
  ).toBeVisible();
  // No Buy buttons while acting as; the API refuses a checkout too.
  await expect(page.getByRole('button', { name: /^Buy / })).toHaveCount(0);
  const packs = (await (await page.request.get('/api/credits')).json()) as {
    packs: { id: string }[];
  };
  const checkout = await page.request.post('/api/credits/checkout', {
    data: { packId: packs.packs[0]?.id },
    headers: { Origin: appOrigin() },
  });
  expect(checkout.status()).toBe(403);
  expect(((await checkout.json()) as { error: { code: string } }).error.code).toBe(
    'ACTING_AS_FORBIDDEN',
  );

  // 5. Account menu → Stop acting as.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: `Stop acting as ${business}` }).click();

  // Expected: Staff are back in their own Business.
  await expect(page).toHaveURL(/\/app\/staff\/customers$/);
  const me = (await (await page.request.get('/api/auth/me')).json()) as {
    actingAs: unknown;
    business: { name: string };
  };
  expect(me.actingAs).toBeNull();
  expect(me.business.name).toBe('Llyner Leads (internal)');

  // 6. The Audit log shows acting_as.started and acting_as.stopped, newest first.
  await page
    .getByRole('navigation', { name: 'Back office navigation' })
    .getByRole('link', { name: 'Audit log' })
    .click();
  await expect(page).toHaveURL(/\/app\/staff\/audit-log$/);
  const entries = page.getByRole('table', { name: 'Audit log entries' }).getByRole('row');
  await expect(entries.nth(1)).toContainText('acting_as.stopped');
  await expect(entries.nth(1)).toContainText(business);
  await expect(entries.nth(2)).toContainText('acting_as.started');
  await expect(entries.nth(2)).toContainText(business);
});
