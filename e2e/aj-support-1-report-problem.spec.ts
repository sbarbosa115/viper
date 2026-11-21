import { expect, test } from './fixtures.js';
import { loginAsStaff } from './journeys.js';
import {
  closeTicket,
  failedRunId,
  memberApi,
  numberFromThreadUrl,
  staffInbox,
  uniqueSubject,
  waitForTicketEmail,
} from './support-helpers.js';

test('AJ-support-1: Sam reports a problem on a failed run and Staff see it waiting @journey', async ({
  page,
  browser,
  loginAs,
  mailpitUrl,
}) => {
  test.setTimeout(150_000);
  const subject = uniqueSubject('Run stopped at Websites');
  const sam = await memberApi('owner@demo.test');
  let number = 0;
  try {
    // 1. Log in as owner@demo.test, open the seeded failed run "Bakeries near Austin".
    await loginAs('owner@demo.test');
    await page.goto(`/app/runs/${await failedRunId(sam)}`);
    await expect(page.getByRole('heading', { name: "This run didn't finish" })).toBeVisible();

    // 2. "Report a problem": New ticket shows the run selected and "Research run / leads" chosen.
    await page.getByRole('link', { name: /Report a problem/ }).click();
    await expect(page).toHaveURL(/\/app\/support\/new\?/);
    const form = page.getByRole('form', { name: 'New ticket' });
    await expect(form.getByRole('button', { name: 'Research run / leads' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(form.getByLabel('Which run?')).toHaveValue(await failedRunId(sam));
    await expect(form.getByLabel('Which run?').locator('option:checked')).toContainText(
      'Bakeries near Austin',
    );

    // 3. Type a subject and message, send.
    await form.getByLabel('Subject').fill(subject);
    await form
      .getByLabel('Message')
      .fill('My run stopped at the Websites step. Can you take a look?');
    await form.getByRole('button', { name: 'Send ticket' }).click();

    // 4. The thread with status "Open" and the toast with the ticket number.
    await expect(page).toHaveURL(/\/app\/support\/\d+$/);
    number = numberFromThreadUrl(page.url());
    await expect(page.getByText(`Ticket #${number} sent.`)).toBeVisible();
    await expect(page.getByRole('heading', { name: subject, level: 1 })).toBeVisible();
    await expect(
      page.getByText('Open', { exact: true }).locator('visible=true').first(),
    ).toBeVisible();
    await expect(page.getByRole('list', { name: 'Conversation' })).toContainText(
      'My run stopped at the Websites step',
    );
    // Linked to the run, visible to the customer in Help.
    await expect(
      page.getByText('Bakeries near Austin').locator('visible=true').first(),
    ).toBeVisible();
    await page.goto('/app/support');
    await expect(
      page.getByRole('list', { name: 'Tickets' }).getByRole('link', { name: new RegExp(subject) }),
    ).toBeVisible();

    // 5. In Mailpit, staff@demo.test has "[#N] New ticket · Research run / leads · Sweet Supply Co".
    const mail = await waitForTicketEmail(mailpitUrl, staffInbox, number, 'New ticket');
    expect(mail.summary.Subject).toBe(
      `[#${number}] New ticket · Research run / leads · Sweet Supply Co`,
    );
    expect(mail.summary.From.Name).toBe('Llyner Leads Support');

    // 6. As Staff, the nav shows "Support" with a badge; the Ticket is in Waiting.
    const staffPage = await (await browser.newContext()).newPage();
    await loginAsStaff(staffPage);
    const nav = staffPage.getByRole('navigation', { name: 'Back office navigation' });
    const supportLink = nav.getByRole('link', { name: /^Support/ });
    await expect(supportLink.getByLabel(/\d+ tickets? waiting/)).toBeVisible();
    await supportLink.click();
    await expect(staffPage).toHaveURL(/\/app\/staff\/support$/);
    const rows = staffPage.getByRole('table', { name: 'Support tickets' }).getByRole('row');
    const row = rows.filter({ hasText: subject });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Sweet Supply Co');
    await expect(row).toContainText('Research run / leads');
    // The Waiting queue is longest wait first (FR-6), so the brand-new Ticket sits below the
    // older seeded waiting one (#1005): PRD AJ-1 says "first", FR-6 and the desk say longest first.
    const order = await rows.allTextContents();
    expect(order.findIndex((t) => t.startsWith('1005'))).toBeGreaterThan(0);
    expect(order.findIndex((t) => t.includes(subject))).toBeGreaterThan(
      order.findIndex((t) => t.startsWith('1005')),
    );
  } finally {
    if (number) await closeTicket(sam, number);
    await sam.dispose();
  }
});
