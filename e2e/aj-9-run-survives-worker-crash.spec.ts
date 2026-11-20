import { expect, test } from './fixtures.js';
import {
  customerWithPlan,
  loginAsStaff,
  readRun,
  runIdFromUrl,
  stopWorkerAfter,
} from './journeys.js';

interface StaffRunDetail {
  status: string;
  attempt: { current: number; max: number };
  creditsSpent: number;
  attempts: {
    n: number;
    outcome: string;
    from: { stepKey: string; item: number };
    reached: { stepKey: string; item: number } | null;
  }[];
  steps: {
    key: string;
    toolCalls: { toolKey: string; millicredits: number; reused: boolean; attempt: number | null }[];
  }[];
}

test('AJ-9: a run survives a worker crash and charges one pass of work @journey', async ({
  page,
  browser,
  mailpitUrl,
}) => {
  // The real sweeper path sets the pace: the lease (5 min, the flow's minimum), the sweeper
  // (every 30 s) and the flow's retry wait (1 min). No shortcut: the lease can't go lower.
  test.setTimeout(900_000);
  const sam = await customerWithPlan(page, mailpitUrl, { buyStarter: true });

  // 1. Start a run; the test hook makes the worker stop in Step 5 after 12 websites.
  await stopWorkerAfter(page.request, 'websites', 12);
  let runId = '';
  try {
    await page.getByRole('button', { name: 'Find leads' }).click();
    await expect(page).toHaveURL(/\/app\/runs\/[0-9a-f-]{36}$/);
    runId = runIdFromUrl(page);

    // 2. The customer's Working screen shows "Taking a little longer than usual".
    await expect(page.getByText(/Taking a little longer than usual/)).toBeVisible({
      timeout: 420_000,
    });
    // Never an attempt number or an error on the customer's screen.
    await expect(page.getByRole('main')).not.toContainText(/attempt|worker|error/i);

    // 3. After the lease expires, attempt 2 resumes and the run completes.
    await expect(page.getByRole('heading', { name: /\d+ leads? ready/ })).toBeVisible({
      timeout: 300_000,
    });
  } finally {
    // A hook the run never took would stop the next journey's run: replace it with a harmless one.
    if (!runId) await stopWorkerAfter(page.request, 'websites', 10_000);
  }
  const run = await readRun(page, runId);
  expect(run.status).toBe('completed');

  // 4. Staff open the run detail.
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  try {
    await loginAsStaff(staff);
    await staff.goto('/app/staff/runs');
    await staff
      .getByRole('row')
      .filter({ hasText: sam.businessName })
      .getByRole('link', { name: `Open run for ${sam.businessName}` })
      .click();
    await expect(staff).toHaveURL(new RegExp(`/app/staff/runs/${runId}$`));

    // Expected: completed with 2 attempts.
    const attempts = staff.getByRole('region', { name: 'Attempts' });
    await expect(attempts.getByRole('heading', { name: /^Attempt \d$/ })).toHaveCount(2);
    const [first, second] = [
      attempts.getByRole('listitem').nth(0),
      attempts.getByRole('listitem').nth(1),
    ];
    // Attempt 1 worker_stopped at website 12; attempt 2 from there (website 13 next).
    await expect(first).toContainText('Ended: worker stopped responding');
    await expect(first).toContainText('reached step 5 Websites, item 12');
    await expect(second).toContainText('Started at step 5 Websites, item 12');
    await expect(second).toContainText('Ended: completed');

    const detailRes = await staff.request.get(`/api/staff/runs/${runId}`);
    expect(detailRes.ok()).toBe(true);
    const detail = (await detailRes.json()) as StaffRunDetail;
    expect(detail.status).toBe('completed');
    expect(detail.attempt.current).toBe(2);
    expect(detail.attempts.map((a) => a.outcome)).toEqual(['worker_stopped', 'completed']);
    expect(detail.attempts[0]?.reached).toEqual({ stepKey: 'websites', item: 12 });
    expect(detail.attempts[1]?.from).toEqual({ stepKey: 'websites', item: 12 });

    // 12 calls not repeated or charged again (FR-36): attempt 1 read websites 1-12, attempt 2 read
    // only the rest. (Attempt 2 starts at website 13, so it never asks for the first 12 again and
    // none shows as "reused"; any call that is answered from storage costs 0 credits.)
    const calls = detail.steps.flatMap((s) => s.toolCalls);
    const websites = calls.filter((c) => c.toolKey === 'firecrawl.scrape');
    expect(websites.filter((c) => c.attempt === 1)).toHaveLength(12);
    expect(websites.filter((c) => c.attempt === 2).length).toBeGreaterThan(0);
    expect(websites.filter((c) => c.reused)).toHaveLength(0);
    expect(calls.filter((c) => c.reused).every((c) => c.millicredits === 0)).toBe(true);

    // Settlement equals one pass of work: what was charged is each call once, never the reuse.
    const charged = calls.filter((c) => !c.reused).reduce((sum, c) => sum + c.millicredits, 0);
    expect(detail.creditsSpent).toBe(run.creditsSpent);
    expect(detail.creditsSpent).toBe(Math.ceil(charged / 1000));
  } finally {
    await staffContext.close();
  }
});
