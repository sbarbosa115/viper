import type { Page } from '@playwright/test';
import { appOrigin, demoPassword, expect, test } from './fixtures.js';

const samTicket = 1001;
const joTicket = 1002;

const openTickets = (page: Page) =>
  page.getByRole('list', { name: 'Tickets' }).getByRole('listitem');

test('AJ-support-5: Members see only their own tickets, Owners see the Business’s @journey', async ({
  page,
  loginAs,
}) => {
  test.setTimeout(90_000);

  // 1. Log in as member@demo.test (Jo Kim): Help lists only Jo's Ticket.
  await loginAs('member@demo.test', demoPassword);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Help' })
    .click();
  await expect(page).toHaveURL(/\/app\/support$/);
  await expect(page.getByRole('heading', { name: 'Your tickets', level: 1 })).toBeVisible();
  await expect(openTickets(page).filter({ hasText: 'Invoice for my Starter pack' })).toHaveCount(1);
  await expect(openTickets(page).filter({ hasText: 'Run stopped at Website reader' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('link', { name: new RegExp(`#${samTicket}`) })).toHaveCount(0);
  const all = await page.request.get('/api/support/tickets?status=all&limit=50');
  const { items } = (await all.json()) as {
    items: { number: number; openedBy: { name: string } }[];
  };
  expect(items.length).toBeGreaterThan(0);
  expect(items.every((t) => t.openedBy.name === 'Jo Kim')).toBe(true);
  expect(items.map((t) => t.number)).toContain(joTicket);

  // 2. Visit /app/support/<Sam's ticket number>: "Ticket not found".
  await page.goto(`/app/support/${samTicket}`);
  await expect(page.getByRole('heading', { name: 'Ticket not found' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Run stopped at Website reader' })).toHaveCount(0);

  // 3. Log in as owner@demo.test: Help lists both, with a From column.
  await page.request.post('/api/auth/logout', { headers: { Origin: appOrigin() } });
  await page.context().clearCookies();
  await loginAs('owner@demo.test');
  await page.goto('/app/support');
  await expect(
    page.getByText('As the Owner you see every ticket from Sweet Supply Co.'),
  ).toBeVisible();
  const sams = openTickets(page).filter({ hasText: `#${samTicket}` });
  const jos = openTickets(page).filter({ hasText: `#${joTicket}` });
  await expect(sams).toHaveCount(1);
  await expect(jos).toHaveCount(1);
  await expect(sams).toContainText('Sam Rivera');
  await expect(jos).toContainText('Jo Kim');
});
