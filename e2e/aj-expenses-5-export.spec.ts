import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures.js';
import { loginAsStaff } from './journeys.js';

/** The seeded month, so the P&L has revenue and costs whatever day the stack runs on. */
const month = '2026-11';

/** "−$325.75" or "$1,049.50" as the P&L prints it, to cents. */
function centsOf(text: string): number {
  const negative = /^[−-]/.test(text.trim());
  const digits = text.replace(/[^0-9.]/g, '');
  return (negative ? -1 : 1) * Math.round(Number(digits) * 100);
}

test('AJ-5: Staff export the P&L as CSV @journey', async ({ page }) => {
  test.setTimeout(90_000);
  await loginAsStaff(page);

  // 1. P&L tab for the month.
  await page.goto(`/app/staff/expenses?tab=pnl&month=${month}`);
  const statement = page.getByRole('table', { name: 'Profit and loss statement' });
  const netRow = statement.getByRole('row').filter({ hasText: /^Net profit/ });
  await expect(netRow).toBeVisible();
  const onScreen = centsOf((await netRow.getByRole('cell').textContent()) ?? '');

  // 2. Export CSV downloads a file named for the range.
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`llyner-leads-pnl-${month}-to-${month}.csv`);

  // Expected: the `net` row of the file equals the net shown on screen.
  const path = await file.path();
  const raw = await readFile(path, 'utf8');
  const csv = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = csv.split(/\r?\n/).filter(Boolean);
  expect(lines[0]).toBe('month,section,category,item,source,amount_usd');
  const net = lines.find((l) => l.startsWith(`${month},net,`));
  expect(net, 'net row').toBeTruthy();
  const amount = (net ?? '').split(',').pop() ?? '';
  expect(Math.round(Number(amount) * 100)).toBe(onScreen);
});
