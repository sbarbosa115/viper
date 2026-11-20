import { availableCredits, expect, fetchVerificationLink, test } from './fixtures.js';

test('AJ-1: Sam signs up, verifies, and describes the business to the assistant @journey', async ({
  page,
  mailpitUrl,
}) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `sam-${suffix}@aj1.test`;

  // 1. Sign up.
  await page.goto('/app/signup');
  await page.getByLabel('Business name').fill(`Sweet Supply Co ${suffix}`);
  await page.getByLabel('Your name').fill('Sam');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Honey-Bun-4-Breakfast!');
  await page.getByRole('button', { name: 'Create account' }).click();

  // 2. The welcome chat, with the unverified notice.
  await expect(page).toHaveURL(/\/app\/?$/, { timeout: 20_000 });
  await expect(page.getByText('Verify your email to get 50 free credits')).toBeVisible();

  // 3. Open the verification link from Mailpit.
  const link = await fetchVerificationLink(mailpitUrl, email);
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();
  await page.getByRole('link', { name: 'Continue setting up' }).click();
  await expect(page).toHaveURL(/\/app\/?$/);
  // The trial grant goes through the outbox and the billing worker.
  await expect.poll(() => availableCredits(page), { timeout: 30_000 }).toBe(50);
  // The header re-reads the balance after verification until the grant shows.
  await expect(page.getByRole('link', { name: /Credits: 50 cr/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Verify your email to get 50 free credits')).toBeHidden();

  // 4. Answer the assistant.
  const send = async (answer: string, expectReply: string | RegExp) => {
    const thread = page.getByRole('log').or(page.getByLabel('Conversation')).first();
    await page.getByLabel('Your answer').fill(answer);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(thread).toContainText(expectReply, { timeout: 20_000 });
  };
  await send('We sell cane sugar in 50 lb bags and powdered sugar', /where|located|address/i);
  // 5. The profile panel fills in as answers arrive.
  const panel = page.getByRole('complementary', { name: 'Business Profile' });
  await expect(panel).toContainText(/Cane sugar/i);
  await send('1200 E 6th St, Austin', /far|radius|deliver|confirm/i);
  await expect(panel).toContainText(/Austin/);
  await send('3 miles', /who|customers|buy/i);
  await expect(panel).toContainText(/3\s*miles/);
  await send('restaurants', 'Who would you like to find?');

  // Expected: profile complete, goal quick replies.
  await expect(page.getByText('Who would you like to find?').last()).toBeVisible();
  await expect(page.getByRole('button', { name: /within 3 miles/ }).first()).toBeVisible();
});
