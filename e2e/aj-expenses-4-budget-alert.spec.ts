import { appOrigin, expect, test } from './fixtures.js';
import { loginAsStaff, staffEmail } from './journeys.js';

const usd = (cents: number): string =>
  `$${Math.trunc(cents / 100).toLocaleString('en-US')}.${(cents % 100).toString().padStart(2, '0')}`;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** How many matching budget alerts Mailpit holds for the Staff Member, and the newest one's text. */
async function budgetAlerts(
  mailpitUrl: string,
  subject: string,
): Promise<{ count: number; text: string }> {
  const query = encodeURIComponent(`to:${staffEmail} subject:"${subject}"`);
  const res = await fetch(`${mailpitUrl}/api/v1/search?query=${query}`);
  const { messages } = (await res.json()) as { messages: { ID: string }[] };
  const newest = messages[0];
  if (!newest) return { count: 0, text: '' };
  const msg = (await (await fetch(`${mailpitUrl}/api/v1/message/${newest.ID}`)).json()) as {
    Text: string;
  };
  return { count: messages.length, text: msg.Text };
}

test('AJ-expenses-4: spend passes the Budget and every Staff Member gets one email @journey', async ({
  page,
  mailpitUrl,
}) => {
  test.setTimeout(120_000);
  const headers = { Origin: appOrigin() };
  const month = MONTHS[new Date().getUTCMonth()] ?? '';
  const subject = `Spend passed 100% of the ${month} budget`;

  await loginAsStaff(page);

  // 1. P&L tab: set the Budget just below this month's spend (Edit budget dialog).
  await page.goto('/app/staff/expenses');
  await expect(page.getByRole('table', { name: 'Profit and loss statement' })).toBeVisible();
  const pnl = await page.request.get('/api/staff/finance/pnl');
  expect(pnl.ok()).toBe(true);
  const spentCents = ((await pnl.json()) as { budget: { spent: { cents: number } } }).budget.spent
    .cents;
  const budgetDollars = Math.ceil(spentCents / 100) - 1;
  expect(budgetDollars, 'this month has some spend').toBeGreaterThan(0);

  const before = await budgetAlerts(mailpitUrl, subject);
  try {
    await page.getByRole('button', { name: 'Edit budget' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Monthly budget' });
    await dialog.getByLabel('Monthly budget (USD)').fill(String(budgetDollars));
    await dialog.getByRole('button', { name: 'Save budget' }).click();
    await expect(dialog).toBeHidden();

    // 2. Run the budget check now. `reset` forgets the alerts the demo seed recorded for the
    // current month, so the check can fire.
    const first = await page.request.post('/api/test/jobs/budget-check', {
      headers,
      data: { reset: true },
    });
    expect(first.status()).toBe(200);
    expect(await first.json()).toEqual({ sent: [100] });

    // 3. Mailpit: one new "100%" email to the Staff Member with the right figures.
    await expect
      .poll(async () => (await budgetAlerts(mailpitUrl, subject)).count, {
        message: `"${subject}" in Mailpit`,
        timeout: 30_000,
      })
      .toBe(before.count + 1);
    const { text } = await budgetAlerts(mailpitUrl, subject);
    const pct = Math.round((spentCents / (budgetDollars * 100)) * 100);
    expect(text).toContain(
      `month-to-date spend is ${usd(spentCents)} of the ${usd(budgetDollars * 100)} budget (${pct}%)`,
    );
    expect(text).toContain('/app/staff/expenses');
    expect(text).toContain(
      'You get this once per threshold (80% and 100%) each month because you are Staff on Llyner Leads.',
    );

    // Triggering again sends nothing new.
    const again = await page.request.post('/api/test/jobs/budget-check', { headers });
    expect(await again.json()).toEqual({ sent: [] });
    await page.waitForTimeout(2_000);
    expect((await budgetAlerts(mailpitUrl, subject)).count).toBe(before.count + 1);
  } finally {
    // Put the demo Budget back for the other journeys.
    await page.request.put('/api/staff/finance/budget', {
      headers,
      data: { monthlyBudgetCents: 30000 },
    });
  }
});
