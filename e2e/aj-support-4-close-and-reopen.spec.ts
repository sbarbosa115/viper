import { appOrigin, expect, test } from './fixtures.js';
import { loginAsStaff } from './journeys.js';
import {
  closeTicket,
  createTicket,
  memberApi,
  ticketEmails,
  uniqueSubject,
  waitForTicketEmail,
} from './support-helpers.js';

test('AJ-support-4: Staff close a ticket, Sam reopens it, and an old one stays closed @journey', async ({
  page,
  browser,
  loginAs,
  mailpitUrl,
}) => {
  test.setTimeout(150_000);
  const subject = uniqueSubject('Invoice question');
  const oldSubject = uniqueSubject('Long closed question');
  const sam = await memberApi('owner@demo.test');
  const number = await createTicket(sam, { subject, category: 'billing' });
  const oldNumber = await createTicket(sam, { subject: oldSubject });
  try {
    const staff = await (await browser.newContext()).newPage();
    await loginAsStaff(staff);

    // 1. As Staff, type a final reply and close the Ticket; Sam gets one "[#N] Closed: …" email.
    await staff.goto(`/app/staff/support/${number}`);
    await staff
      .getByLabel('Reply to Sam')
      .fill('The invoice is in your Credits page. Closing this one.');
    await staff.getByRole('button', { name: 'Close ticket' }).click();
    await expect(staff.getByLabel('Status')).toHaveValue('closed');
    const mail = await waitForTicketEmail(mailpitUrl, 'owner@demo.test', number, 'Closed');
    expect(mail.summary.Subject).toBe(`[#${number}] Closed: ${subject}`);
    expect(mail.text).toContain('The invoice is in your Credits page.');
    expect(await ticketEmails(mailpitUrl, 'owner@demo.test', number)).toHaveLength(1);

    // 2. As Sam, the Ticket shows "Closed"; replying reopens it and it returns to Waiting.
    await loginAs('owner@demo.test');
    await page.goto(`/app/support/${number}`);
    await expect(
      page.getByText('Closed', { exact: true }).locator('visible=true').first(),
    ).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Reply', exact: true })
      .fill('Actually, one more thing');
    await page.getByRole('button', { name: 'Send reply' }).click();
    await expect(page.getByRole('list', { name: 'Conversation' })).toContainText(
      'Actually, one more thing',
    );
    await expect(
      page.getByText('Open', { exact: true }).locator('visible=true').first(),
    ).toBeVisible();
    await staff.goto('/app/staff/support');
    const row = staff
      .getByRole('table', { name: 'Support tickets' })
      .getByRole('row')
      .filter({ hasText: subject });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('new customer reply');

    // 3. The seeded Ticket closed 40 days ago: the reply box is replaced by "Open a new ticket".
    await page.goto('/app/support/1004');
    await expect(
      page.getByRole('heading', { name: "Can't find the CSV export", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open a new ticket' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Reply', exact: true })).toHaveCount(0);

    // The same holds for a Ticket this journey closes and back-dates past 30 days (test hook).
    await closeTicket(sam, oldNumber);
    const hook = await page.request.post('/api/test/support/close-ago', {
      data: { number: oldNumber, days: 31 },
      headers: { Origin: appOrigin() },
    });
    expect(hook.ok(), `close-ago: ${hook.status()}`).toBe(true);
    await page.goto(`/app/support/${oldNumber}`);
    await expect(page.getByRole('link', { name: 'Open a new ticket' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Reply', exact: true })).toHaveCount(0);
    const refused = await sam.post(`/api/support/tickets/${oldNumber}/replies`, {
      data: { message: 'Too late to reopen this one' },
    });
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'TICKET_CLOSED_TOO_LONG',
    );
  } finally {
    await closeTicket(sam, number);
    await closeTicket(sam, oldNumber);
    await sam.dispose();
  }
});
