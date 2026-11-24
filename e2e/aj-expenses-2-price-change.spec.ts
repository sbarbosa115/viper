import type { Page } from '@playwright/test';
import { appOrigin, expect, test } from './fixtures.js';
import { loginAsStaff } from './journeys.js';

interface Pnl {
  totalExpenses: { cents: number };
}
interface ExpenseRow {
  id: string;
  name: string;
  versions: { effectiveFrom: string }[];
}

const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);

/** The 18th of next month (UTC), as an ISO date. */
function eighteenthOfNextMonth(): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 18)).toISOString().slice(0, 10);
}
const priceDate = eighteenthOfNextMonth();
const priceDateLabel = new Date(`${priceDate}T00:00:00Z`).toLocaleDateString('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

async function findResend(page: Page): Promise<ExpenseRow> {
  const res = await page.request.get(`/api/staff/finance/expenses?month=${month}`);
  expect(res.ok(), `list expenses: ${res.status()}`).toBe(true);
  const { items } = (await res.json()) as { items: ExpenseRow[] };
  const resend = items.find((e) => e.name === 'Resend');
  expect(resend, 'seeded Resend bill').toBeTruthy();
  return resend!;
}

/** Drops the price change made by this journey, so a repeat starts from the seeded price. */
async function removePriceChange(page: Page): Promise<void> {
  const resend = await findResend(page);
  if (resend.versions.some((v) => v.effectiveFrom === priceDate)) {
    await page.request.delete(`/api/staff/finance/expenses/${resend.id}/prices/${priceDate}`, {
      headers: { Origin: appOrigin() },
    });
  }
}

async function totalExpenses(page: Page): Promise<number> {
  const res = await page.request.get(`/api/staff/finance/pnl?month=${month}`);
  expect(res.ok(), `pnl: ${res.status()}`).toBe(true);
  return ((await res.json()) as Pnl).totalExpenses.cents;
}

test('AJ-2: Staff change a price from a date @journey', async ({ page }) => {
  test.setTimeout(90_000);
  await loginAsStaff(page);
  await removePriceChange(page);
  try {
    const totalBefore = await totalExpenses(page);

    // 1. On Expenses, open "Resend" and add a price change: $25.00 from the 18th of next month.
    await page.goto(`/app/staff/expenses?tab=expenses&month=${month}`);
    const resendRow = page.getByRole('row').filter({ hasText: 'Resend' });
    await expect(resendRow).toContainText('$20.00');
    await page.getByRole('button', { name: 'Open Resend' }).click();
    const panel = page.getByRole('form', { name: 'Edit Resend' });
    await panel.getByLabel('New amount (USD)').fill('25.00');
    await panel.getByLabel('From').fill(priceDate);
    await panel.getByRole('button', { name: 'Add price change' }).click();

    // 2. The panel lists both versions.
    const history = panel.getByRole('group', { name: 'Price history' });
    await expect(history).toContainText('$20.00 from Nov 18, 2026');
    await expect(history).toContainText(`$25.00 from ${priceDateLabel}`);

    // 3. Switch the month selector to another month and back (reload when there is only one).
    const select = page.getByLabel('Month');
    const choices = select.locator('option');
    const other = (await choices.count()) > 1 ? await choices.nth(1).getAttribute('value') : null;
    if (other) {
      await select.selectOption(other);
      await expect(page).toHaveURL(new RegExp(`month=${other}`));
      await select.selectOption(month);
      await expect(page).toHaveURL(new RegExp(`month=${month}`));
    } else {
      await page.reload();
    }

    // Expected: this month still shows Resend at $20.00 and costs the same; the price change is
    // listed as the next version.
    await expect(page.getByRole('row').filter({ hasText: 'Resend' })).toContainText('$20.00');
    expect(await totalExpenses(page)).toBe(totalBefore);
    await page.getByRole('button', { name: 'Open Resend' }).click();
    const reopened = page.getByRole('group', { name: 'Price history' });
    await expect(reopened).toContainText('$20.00 from Nov 18, 2026');
    await expect(reopened).toContainText(`$25.00 from ${priceDateLabel}`);
  } finally {
    await removePriceChange(page);
  }
});
