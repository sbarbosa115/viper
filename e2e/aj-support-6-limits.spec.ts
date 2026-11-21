import { appOrigin, expect, test } from './fixtures.js';
import { businessIdOf } from './journeys.js';
import { closeTicket, memberApi } from './support-helpers.js';

const validMessage = 'The export button is missing from my lead list page.';

test('AJ-support-6: bad input and the open-ticket limit create nothing, Members have no back office @journey', async ({
  page,
  loginAs,
}) => {
  test.setTimeout(90_000);
  const sam = await memberApi('owner@demo.test');
  let fillers: number[] = [];
  try {
    await loginAs('member@demo.test');
    const totalTickets = async (): Promise<number> => {
      const res = await sam.get('/api/support/tickets?status=all&limit=50');
      return ((await res.json()) as { items: unknown[] }).items.length;
    };
    const before = await totalTickets();
    const form = page.getByRole('form', { name: 'New ticket' });

    // 1. Submit New ticket with a 3-character subject: inline error, nothing sent.
    await page.goto('/app/support/new');
    await form.getByRole('button', { name: 'Other' }).click();
    await form.getByLabel('Subject').fill('abc');
    await form.getByLabel('Message').fill(validMessage);
    await form.getByRole('button', { name: 'Send ticket' }).click();
    await expect(form.getByText('Use at least 5 characters')).toBeVisible();
    await expect(page).toHaveURL(/\/app\/support\/new$/);
    expect(await totalTickets()).toBe(before);

    // 2. With the Business at 5 open Tickets (test helper), a valid Ticket is refused, text kept.
    const fill = await page.request.post('/api/test/support/fill-open', {
      data: { businessId: await businessIdOf(page), count: 5 },
      headers: { Origin: appOrigin() },
    });
    expect(fill.ok(), `fill-open: ${fill.status()}`).toBe(true);
    fillers = ((await fill.json()) as { numbers: number[] }).numbers;
    const afterFill = await totalTickets();

    await page.goto('/app/support/new');
    await form.getByRole('button', { name: 'Other' }).click();
    await form.getByLabel('Subject').fill('Cannot find the export');
    await form.getByLabel('Message').fill(validMessage);
    await form.getByRole('button', { name: 'Send ticket' }).click();
    await expect(
      page.getByText('You have 5 open tickets. Reply on one of them or close one first.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to Your tickets' })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/support\/new$/);
    await expect(form.getByLabel('Subject')).toHaveValue('Cannot find the export');
    await expect(form.getByLabel('Message')).toHaveValue(validMessage);
    expect(await totalTickets()).toBe(afterFill);

    // 3. As a Member, /app/staff/support: the back office is not available.
    await expect(page.getByRole('navigation', { name: 'Back office navigation' })).toHaveCount(0);
    await page.goto('/app/staff/support');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Back office navigation' })).toHaveCount(0);
    const api = await page.request.get('/api/staff/support/tickets');
    expect([401, 403, 404]).toContain(api.status());
  } finally {
    for (const number of fillers) await closeTicket(sam, number);
    await sam.dispose();
  }
});
