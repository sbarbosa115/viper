import type { Page } from '@playwright/test';
import { appOrigin, expect, test } from './fixtures.js';
import { loginAsStaff } from './journeys.js';

const month = new Date().toISOString().slice(0, 7);

/** Tomorrow in UTC, the day the form refuses. */
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

interface ExpenseRow {
  id: string;
  name: string;
}

async function expenseNames(page: Page): Promise<string[]> {
  const res = await page.request.get(
    `/api/staff/finance/expenses?month=${month}&includeEnded=true`,
  );
  expect(res.ok(), `list expenses: ${res.status()}`).toBe(true);
  return ((await res.json()) as { items: ExpenseRow[] }).items.map((e) => e.name);
}

test('AJ-6: Expenses are not for customers, and a future date is refused @journey', async ({
  page,
  loginAs,
}) => {
  test.setTimeout(120_000);

  // 1. An Owner has no back office navigation, and the page is not found.
  await loginAs('owner@demo.test');
  await expect(page.getByRole('navigation', { name: 'Back office navigation' })).toHaveCount(0);
  await page.goto('/app/staff/expenses');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  const api = await page.request.get('/api/staff/finance/expenses?month=2026-11');
  expect([401, 403, 404]).toContain(api.status());
  await page.request.post('/api/auth/logout', { headers: { Origin: appOrigin() } });

  // 2. Staff add a One-off dated tomorrow: the form says why, and nothing is saved.
  await page.context().clearCookies();
  await loginAsStaff(page);
  const namesBefore = await expenseNames(page);
  await page.goto(`/app/staff/expenses?tab=expenses&month=${month}`);
  await page.getByRole('button', { name: 'Add expense' }).first().click();
  const form = page.getByRole('form', { name: 'Add expense' });
  await form.getByRole('radio', { name: 'One-off' }).click();
  await form.getByLabel('Name', { exact: true }).fill('Future lunch');
  await form.getByLabel('Vendor').fill('Cafe');
  await form.getByLabel('Category').selectOption({ label: 'Other' });
  await form.getByLabel('Amount (USD)').fill('12.00');
  await form.getByLabel('Paid on').fill(tomorrow);
  await form.getByRole('button', { name: 'Save expense' }).click();

  await expect(form.getByText("Date can't be in the future")).toBeVisible();
  await expect(form).toBeVisible();
  expect(await expenseNames(page)).toEqual(namesBefore);
});
