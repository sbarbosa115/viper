import type { Page } from '@playwright/test';
import { appOrigin, expect, test } from './fixtures.js';
import { loginAsStaff } from './journeys.js';

interface Pnl {
  totalExpenses: { cents: number };
  netProfit: { cents: number };
  categories: { category: string; amount: { cents: number } }[];
  budget: { spent: { cents: number }; amount: { cents: number }; pct: number | null };
}
interface ExpenseRow {
  id: string;
  name: string;
}

const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);

/** The same day next month (UTC), clamped to the month's last day, as the bill's next charge. */
function sameDayNextMonth(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, lastDay))).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const dollars = (cents: number): string =>
  `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

async function readPnl(page: Page): Promise<Pnl> {
  const res = await page.request.get(`/api/staff/finance/pnl?month=${month}`);
  expect(res.ok(), `pnl: ${res.status()}`).toBe(true);
  return (await res.json()) as Pnl;
}

/** Removes every "Figma" bill, so the journey is independent of other runs. */
async function removeFigma(page: Page): Promise<void> {
  const res = await page.request.get(
    `/api/staff/finance/expenses?month=${month}&includeEnded=true`,
  );
  expect(res.ok(), `list expenses: ${res.status()} ${await res.text()}`).toBe(true);
  const { items } = (await res.json()) as { items: ExpenseRow[] };
  for (const e of items.filter((x) => x.name === 'Figma')) {
    await page.request.delete(`/api/staff/finance/expenses/${e.id}`, {
      headers: { Origin: appOrigin() },
    });
  }
}

test('AJ-1: Staff add a bill and see it in the P&L @journey', async ({ page }) => {
  test.setTimeout(90_000);
  // 1. Sign in as Staff (TOTP), open Back office → Expenses.
  await loginAsStaff(page);
  await removeFigma(page);
  try {
    const before = await readPnl(page);
    const softwareBefore =
      before.categories.find((c) => c.category === 'software_tools')?.amount.cents ?? 0;

    await page
      .getByRole('navigation', { name: 'Back office navigation' })
      .getByRole('link', { name: 'Expenses' })
      .click();
    await expect(page).toHaveURL(/\/app\/staff\/expenses/);
    await page.getByRole('tab', { name: 'Expenses', exact: true }).click();
    await expect(page).toHaveURL(/tab=expenses/);

    // 2. Add expense: recurring, monthly, Figma, Software & tools, $15.00, starting today.
    await page.getByRole('button', { name: 'Add expense' }).first().click();
    const form = page.getByRole('form', { name: 'Add expense' });
    await form.getByRole('radio', { name: 'Monthly' }).click();
    await form.getByLabel('Name', { exact: true }).fill('Figma');
    await form.getByLabel('Vendor').fill('Figma');
    await form.getByLabel('Category').selectOption({ label: 'Software & tools' });
    await form.getByLabel('Amount (USD)').fill('15.00');
    await expect(form.getByLabel('First charge')).toHaveValue(today);
    await form.getByRole('button', { name: 'Save expense' }).click();

    // 3. The bill appears in the list with its next charge next month.
    const row = page.getByRole('row').filter({ hasText: 'Figma' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Software & tools');
    await expect(row).toContainText('$15.00');
    await expect(row).toContainText(sameDayNextMonth(today));

    // 4. P&L tab: Software & tools is up by $15.00; expenses, net and budget moved with it.
    await page.getByRole('tab', { name: 'P&L' }).click();
    const after = await readPnl(page);
    const softwareAfter =
      after.categories.find((c) => c.category === 'software_tools')?.amount.cents ?? 0;
    expect(softwareAfter - softwareBefore).toBe(1500);
    expect(after.totalExpenses.cents - before.totalExpenses.cents).toBe(1500);
    expect(before.netProfit.cents - after.netProfit.cents).toBe(1500);
    expect(after.budget.spent.cents - before.budget.spent.cents).toBe(1500);

    const categories = page.getByRole('table', { name: 'Expenses by category' });
    await expect(categories.getByRole('row').filter({ hasText: 'Software & tools' })).toContainText(
      dollars(softwareAfter),
    );
    const statement = page.getByRole('table', { name: 'Profit and loss statement' });
    await expect(statement.getByRole('row').filter({ hasText: /^Net profit/ })).toContainText(
      dollars(after.netProfit.cents),
    );
    await expect(
      page.getByText(
        `${dollars(after.budget.spent.cents)} of ${dollars(after.budget.amount.cents)}`,
        { exact: true },
      ),
    ).toBeVisible();

    // The Audit log has expense.created, newest first.
    await page
      .getByRole('navigation', { name: 'Back office navigation' })
      .getByRole('link', { name: 'Audit log' })
      .click();
    await expect(page).toHaveURL(/\/app\/staff\/audit-log$/);
    const entries = page.getByRole('table', { name: 'Audit log entries' }).getByRole('row');
    await expect(entries.nth(1)).toContainText('expense.created');
  } finally {
    await removeFigma(page);
  }
});
