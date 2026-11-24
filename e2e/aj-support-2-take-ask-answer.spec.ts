import { expect, test } from './fixtures.js';
import { loginAsStaff } from './journeys.js';
import {
  closeTicket,
  createTicket,
  memberApi,
  staffInbox,
  ticketEmails,
  uniqueSubject,
  waitForTicketEmail,
} from './support-helpers.js';

test('AJ-support-2: Staff take a ticket, ask, and Sam answers @journey', async ({
  page,
  browser,
  loginAs,
  mailpitUrl,
}) => {
  test.setTimeout(150_000);
  const subject = uniqueSubject('Which phone numbers look wrong');
  const sam = await memberApi('owner@demo.test');
  const number = await createTicket(sam, {
    subject,
    category: 'run',
    message: 'Two of the phone numbers in my leads look wrong.',
  });
  try {
    const staff = await (await browser.newContext()).newPage();
    await loginAsStaff(staff);

    // 1. As Staff, open the waiting Ticket, click "Take it": IN PROGRESS, assigned to you.
    await staff.goto('/app/staff/support');
    await staff.getByRole('link', { name: subject }).click();
    await expect(staff).toHaveURL(new RegExp(`/app/staff/support/${number}$`));
    await expect(staff.getByLabel('Status')).toHaveValue('open');
    await staff.getByRole('button', { name: 'Take it' }).click();
    await expect(staff.getByText('Taken by you', { exact: true })).toBeVisible();
    await expect(staff.getByLabel('Status')).toHaveValue('in_progress');
    await expect(staff.getByLabel('Assignee').locator('option:checked')).toContainText('You (');

    // 2. Write a question, click "Reply & wait on customer".
    await staff.getByLabel('Reply to Sam').fill('Which two numbers look wrong to you?');
    await staff.getByRole('button', { name: 'Reply & wait on customer' }).click();
    await expect(staff.getByLabel('Status')).toHaveValue('waiting_on_customer');
    await expect(staff.getByRole('list', { name: 'Conversation' })).toContainText(
      'Which two numbers look wrong to you?',
    );

    // 3. As Sam, Mailpit has "[#N] New reply: …"; Help shows "Waiting on you"; Sam replies.
    const mail = await waitForTicketEmail(mailpitUrl, 'owner@demo.test', number, 'New reply');
    expect(mail.summary.Subject).toBe(`[#${number}] New reply: ${subject}`);
    expect(mail.text).toContain('Which two numbers look wrong to you?');
    await loginAs('owner@demo.test');
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Help' })
      .click();
    const item = page
      .getByRole('list', { name: 'Tickets' })
      .getByRole('listitem')
      .filter({ hasText: subject });
    await expect(item).toContainText('Waiting on you');
    await item.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/app/support/${number}$`));
    await page
      .getByRole('textbox', { name: 'Reply', exact: true })
      .fill('The two numbers for the bakeries on 6th Street.');
    await page.getByRole('button', { name: 'Send reply' }).click();
    await expect(page.getByRole('list', { name: 'Conversation' })).toContainText(
      'The two numbers for the bakeries on 6th Street.',
    );

    // 4. As Staff, the Ticket is back in Waiting with "new customer reply"; Mailpit has the email.
    const replyMail = await waitForTicketEmail(mailpitUrl, staffInbox, number, 'New reply');
    expect(replyMail.summary.Subject).toBe(`[#${number}] New reply · Sweet Supply Co`);
    expect(replyMail.text).toContain('The two numbers for the bakeries on 6th Street.');
    await staff.goto('/app/staff/support');
    const row = staff
      .getByRole('table', { name: 'Support tickets' })
      .getByRole('row')
      .filter({ hasText: subject });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('new customer reply');
    await expect(row).toContainText('IN PROGRESS');
    await row.getByRole('link', { name: subject }).click();
    await expect(staff.getByLabel('Status')).toHaveValue('in_progress');
    await expect(staff.getByRole('list', { name: 'Conversation' })).toContainText(
      'The two numbers for the bakeries on 6th Street.',
    );
    // Opening it marks it read: it leaves Waiting.
    await staff.goto('/app/staff/support');
    await expect(staff.getByRole('table', { name: 'Support tickets' })).toBeVisible();
    await expect(staff.getByRole('link', { name: subject })).toHaveCount(0);

    // Each side got exactly one email per counterpart message.
    expect(await ticketEmails(mailpitUrl, 'owner@demo.test', number)).toHaveLength(1);
    expect(
      (await ticketEmails(mailpitUrl, staffInbox, number)).filter((m) =>
        m.Subject.includes('New reply'),
      ),
    ).toHaveLength(1);
  } finally {
    await closeTicket(sam, number);
    await sam.dispose();
  }
});
