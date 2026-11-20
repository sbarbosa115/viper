import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures.js';
import {
  bakeriesGoal,
  buyStarterPack,
  describeBusiness,
  readRun,
  runIdFromUrl,
  signUpVerified,
  waitForEmail,
  wallet,
} from './journeys.js';

test('AJ-2: from the goal quick reply to rated leads and a CSV @journey', async ({
  page,
  mailpitUrl,
}) => {
  test.setTimeout(240_000);

  // From AJ-1's end: a verified customer whose profile is complete. A Starter pack covers the
  // 400-credit budget (50 trial credits would hit AJ-4's not-enough-credits dialog).
  const sam = await signUpVerified(page, mailpitUrl);
  await describeBusiness(page);
  await buyStarterPack(page);
  const before = await wallet(page);

  // 1. Click the quick reply.
  await page.goto('/app/chat');
  await page.getByRole('button', { name: bakeriesGoal }).click();

  // 2. The Plan: a Bakeries segment, Fit signals as chips, a 3-mile map, "Up to 400 credits".
  await expect(page).toHaveURL(/\/app\/plans\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const planId = new URL(page.url()).pathname.split('/').pop() ?? '';
  await expect(page.getByLabel('Target type 1 name')).toHaveValue(/Bakeries/i);
  await expect(page.getByRole('button', { name: /^Remove .+/ }).first()).toBeVisible();
  await expect(page.getByRole('img', { name: /Map preview · 3 mi around/ })).toBeVisible();
  await expect(page.getByLabel('Radius (miles)')).toHaveValue('3');
  await expect(page.getByText(/Up to 400 credits/)).toBeVisible();

  // 3. Find leads: the working screen shows the step checklist.
  await page.getByRole('button', { name: 'Find leads' }).click();
  await expect(page).toHaveURL(/\/app\/runs\/[0-9a-f-]{36}$/);
  const runId = runIdFromUrl(page);
  const checklist = page.getByRole('list', { name: 'Research steps' });
  await expect(checklist.getByRole('listitem')).toHaveCount(10);
  await expect(checklist).toContainText('Search terms');

  // 4. The run completes on the fake Tools: "n leads ready".
  await expect(page.getByRole('heading', { name: /\d+ leads? ready/ })).toBeVisible({
    timeout: 180_000,
  });
  const run = await readRun(page, runId);
  expect(run.status).toBe('completed');
  expect(run.leadsDelivered).toBeGreaterThanOrEqual(2);

  // 5. Mailpit has "Your leads are ready".
  await waitForEmail(mailpitUrl, sam.email, 'Your leads are ready');

  // 6. Open the list, press J to move, mark one "Good lead" and one "Not a fit · Closed".
  await page.getByRole('link', { name: 'See leads' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/plans/${planId}/leads`));
  const rows = page.getByRole('list', { name: 'Lead list' }).getByRole('button');
  await expect(rows).toHaveCount(run.leadsDelivered > 25 ? 25 : run.leadsDelivered);
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');
  const preview = page.getByRole('complementary', { name: 'Lead preview' });

  // Expected: Fit scores, Evidence and verified contacts on the Lead.
  await expect(preview.getByRole('heading', { name: 'Evidence' })).toBeVisible();
  await expect(preview.getByText('verified').first()).toBeVisible();

  const leadName = preview.getByRole('heading', { level: 2 }).first();
  /** J moves to the next row; the preview follows it. */
  const next = async (index: number): Promise<string> => {
    const previous = (await leadName.textContent()) ?? '';
    await page.keyboard.press('j');
    await expect(rows.nth(index)).toHaveAttribute('aria-current', 'true');
    await expect(leadName).not.toHaveText(previous);
    await expect(rows.nth(index)).toContainText((await leadName.textContent()) ?? '');
    return ((await leadName.textContent()) ?? '').trim();
  };

  const goodName = await next(1);
  await preview.getByRole('button', { name: /Good lead/ }).click();
  await expect(preview.getByText('Marked good. Change it anytime.')).toBeVisible();
  await expect(rows.nth(1)).toContainText('Good lead');

  const notFitName = await next(2);
  await preview.getByRole('button', { name: /Not a fit/ }).click();
  await expect(preview.getByText('Marked not a fit. Change it anytime.')).toBeVisible();
  await preview.getByRole('button', { name: 'Closed' }).click();
  await expect(preview.getByRole('button', { name: 'Closed' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(rows.nth(2)).toContainText('Not a fit');

  // 7. Export CSV: it has the Leads.
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export CSV' }).click();
  const download = await downloading;
  const csv = await readFile((await download.path()) ?? '', 'utf8');
  const lines = csv.trim().split(/\r?\n/);
  expect(lines.length).toBe(run.leadsDelivered + 1);
  expect(csv).toContain(goodName);
  expect(csv).toContain(notFitName);

  // Expected: the wallet shows the settled cost and the released Reservation.
  const after = await wallet(page);
  expect(after.reserved).toBe(0);
  expect(after.available).toBe(before.available - run.creditsSpent);
  await page.goto('/app/credits');
  const entry = page.getByRole('row', { name: /Run · / }).first();
  await expect(entry).toBeVisible();
  // Debits show with a minus sign (U+2212).
  await expect(entry).toContainText(`−${run.creditsSpent.toLocaleString('en-US')}`);
});
