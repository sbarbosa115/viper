import type { Page } from '@playwright/test';
import { appOrigin, expect, test } from './fixtures.js';
import { loginAsStaff } from './journeys.js';

/** The seeded month with Tool-call costs for every provider (PRD section 8a). */
const month = '2026-11';

interface Row {
  provider: { key: string; name: string };
  metered: { cents: number };
  invoice: { amount: { cents: number } } | null;
}
interface Invoices {
  rows: Row[];
  flaggedCount: number;
}
interface Pnl {
  grossProfit: { cents: number };
  costOfRevenue: { lines: { label: string; amount: { cents: number } }[] };
}

const dollars = (cents: number): string =>
  `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

async function readInvoices(page: Page): Promise<Invoices> {
  const res = await page.request.get(`/api/staff/finance/provider-invoices?month=${month}`);
  expect(res.ok(), `provider invoices: ${res.status()}`).toBe(true);
  return (await res.json()) as Invoices;
}

async function readPnl(page: Page): Promise<Pnl> {
  const res = await page.request.get(`/api/staff/finance/pnl?month=${month}`);
  expect(res.ok(), `pnl: ${res.status()}`).toBe(true);
  return (await res.json()) as Pnl;
}

const dataProviders = (pnl: Pnl): number =>
  pnl.costOfRevenue.lines.find((l) => l.label === 'Data providers')?.amount.cents ?? 0;

/** Reverts Twilio to its estimate, so the journey starts and ends without an invoice. */
async function revertTwilioInvoice(page: Page): Promise<void> {
  const twilio = (await readInvoices(page)).rows.find((r) => r.provider.name === 'Twilio');
  if (twilio?.invoice) {
    await page.request.delete(
      `/api/staff/finance/provider-invoices/${twilio.provider.key}/${month}`,
      { headers: { Origin: appOrigin() } },
    );
  }
}

test('AJ-3: Staff enter a provider invoice and catch a gap @journey', async ({ page }) => {
  test.setTimeout(90_000);
  await loginAsStaff(page);
  await revertTwilioInvoice(page);
  try {
    const invoicesBefore = await readInvoices(page);
    const twilio = invoicesBefore.rows.find((r) => r.provider.name === 'Twilio');
    expect(twilio, 'Twilio row with metered usage').toBeTruthy();
    const metered = twilio?.metered.cents ?? 0;
    expect(metered, 'seeded Twilio usage').toBeGreaterThan(0);
    const pnlBefore = await readPnl(page);
    const gap = `+${(((150 - metered) / metered) * 100).toFixed(1)}%`;

    // 1. Provider invoices tab, November 2026: Twilio shows source estimate.
    await page.goto(`/app/staff/expenses?tab=invoices&month=${month}`);
    const row = page.getByRole('row').filter({ hasText: /^Twilio/ });
    await expect(row).toContainText('estimate');
    await expect(row).toContainText(dollars(metered));

    // 2. Enter an invoice of $1.50 and save.
    await row.getByLabel('Twilio invoice for November 2026').fill('1.50');
    await row.getByRole('button', { name: 'Save Twilio invoice' }).click();

    // 3. Twilio shows source invoice, the gap, a flag, and the banner counts it.
    await expect(row).not.toContainText('estimate');
    await expect(row).toContainText('invoice');
    await expect(row).toContainText('$1.50');
    await expect(row).toContainText(gap);
    await expect(row).toContainText('Gap: Twilio billed');
    const flagged = invoicesBefore.flaggedCount + 1;
    await expect(
      page.getByText(flagged === 1 ? '1 gap over 15%' : `${flagged} gaps over 15%`),
    ).toBeVisible();

    // 4. P&L tab: Data providers count $1.50 for Twilio instead of the metered amount.
    await page.getByRole('tab', { name: 'P&L' }).click();
    const delta = 150 - metered;
    const statement = page.getByRole('table', { name: 'Profit and loss statement' });
    const pnlAfter = await readPnl(page);
    expect(dataProviders(pnlAfter) - dataProviders(pnlBefore)).toBe(delta);
    expect(pnlBefore.grossProfit.cents - pnlAfter.grossProfit.cents).toBe(delta);
    await expect(statement.getByRole('row').filter({ hasText: /^Data providers/ })).toContainText(
      dollars(dataProviders(pnlAfter)),
    );
    await expect(statement.getByRole('row').filter({ hasText: /^Gross profit/ })).toContainText(
      dollars(pnlAfter.grossProfit.cents),
    );
  } finally {
    await revertTwilioInvoice(page);
  }
});
