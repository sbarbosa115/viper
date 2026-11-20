import { expect, test } from './fixtures.js';
import {
  customerWithPlan,
  loginAsStaff,
  readRun,
  runIdFromUrl,
  setFakeTool,
  waitForEmail,
  wallet,
} from './journeys.js';

const PLACES = 'google.places-text-search';
const MAPS = 'apify.google-maps';
/**
 * PRD gap: AJ-5 names only Places and Apify Maps, but section 7 (External integrations) says Step 2
 * continues on Overpass when both are down, and it does (the run completes). For the run to fail
 * as AJ-5 expects, every Step 2 provider must error, so Overpass errors too.
 */
const OVERPASS = 'osm.overpass';

test('AJ-5: a run that fails is free, and Staff see why @journey', async ({
  page,
  browser,
  mailpitUrl,
}) => {
  test.setTimeout(720_000);
  const sam = await customerWithPlan(page, mailpitUrl, { buyStarter: true });
  const before = await wallet(page);

  // 1. The fake Places and Apify Maps Tools are set to error.
  await setFakeTool(page.request, { mode: 'failAlways', toolKey: PLACES });
  await setFakeTool(page.request, { mode: 'failAlways', toolKey: MAPS });
  await setFakeTool(page.request, { mode: 'failAlways', toolKey: OVERPASS });
  try {
    // 2. Start a run.
    await page.getByRole('button', { name: 'Find leads' }).click();
    await expect(page).toHaveURL(/\/app\/runs\/[0-9a-f-]{36}$/);
    const runId = runIdFromUrl(page);
    await expect(page.getByRole('list', { name: 'Research steps' })).toBeVisible();

    // Provider errors are retryable: 3 attempts, 1 and 5 minutes apart (flow settings), then the
    // run fails. Meanwhile the customer sees it still working.
    // Expected: the working screen says it didn't finish and charged nothing.
    await expect(page.getByRole('heading', { name: "This run didn't finish" })).toBeVisible({
      timeout: 600_000,
    });
    await expect(page.getByText('You were charged 0 credits.')).toBeVisible();
    const run = await readRun(page, runId);
    expect(run.status).toBe('failed');
    expect(run.creditsSpent).toBe(0);

    // The full Reservation is released.
    const after = await wallet(page);
    expect(after.reserved).toBe(0);
    expect(after.available).toBe(before.available);

    // "didn't finish" email in Mailpit.
    await waitForEmail(mailpitUrl, sam.email, "didn't finish");

    // Staff see the run failed with PROVIDER_ERROR in /app/staff/runs.
    const staffContext = await browser.newContext();
    const staff = await staffContext.newPage();
    try {
      await loginAsStaff(staff);
      await staff.goto('/app/staff/runs');
      const row = staff.getByRole('row').filter({ hasText: sam.businessName });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('Failed');
      await expect(row).toContainText('PROVIDER_ERROR');
      await row.getByRole('link', { name: `Open run for ${sam.businessName}` }).click();
      await expect(staff).toHaveURL(new RegExp(`/app/staff/runs/${runId}$`));
      await expect(staff.getByRole('main')).toContainText('PROVIDER_ERROR');
    } finally {
      await staffContext.close();
    }
  } finally {
    await setFakeTool(page.request, { mode: 'reset' });
  }
});
