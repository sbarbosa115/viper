import { expect, test } from './fixtures.js';
import { loginAsStaff } from './journeys.js';
import { closeTicket, createTicket, memberApi, uniqueSubject } from './support-helpers.js';

const business = 'Sweet Supply Co';

test('AJ-support-3: Staff add an internal note and open as the Business @journey', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const subject = uniqueSubject('Credits look off');
  const note = `Checked the ledger, looks fine ${Date.now()}`;
  const sam = await memberApi('owner@demo.test');
  const number = await createTicket(sam, { subject, category: 'billing' });
  try {
    await loginAsStaff(page);

    // 1. Open a Ticket, switch to "Internal note", add a note.
    await page.goto(`/app/staff/support/${number}`);
    await page.getByRole('tab', { name: 'Internal note' }).click();
    await page.getByRole('textbox', { name: 'Internal note' }).fill(note);
    await page.getByRole('button', { name: 'Add note' }).click();
    const thread = page.getByRole('list', { name: 'Conversation' });
    await expect(thread).toContainText(note);
    await expect(thread).toContainText('INTERNAL NOTE');
    // The customer API never carries it.
    expect(await (await sam.get(`/api/support/tickets/${number}`)).text()).not.toContain(note);

    // 2. "Open as this Business": the Acting as banner shows; open Help and the Ticket.
    await page.getByRole('button', { name: 'Open as this Business' }).click();
    // There is no Acting as banner in this version (founder's decision, prd-first-version): the
    // app shows the Business in the breadcrumb and the account menu offers "Stop acting as".
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(business);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByRole('menuitem', { name: `Stop acting as ${business}` })).toBeVisible();
    await page.keyboard.press('Escape');
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Help' })
      .click();
    await page.getByRole('link', { name: new RegExp(subject) }).click();
    await expect(page).toHaveURL(new RegExp(`/app/support/${number}$`));
    await expect(page.getByRole('heading', { name: subject, level: 1 })).toBeVisible();

    // The note isn't visible while Acting as, and the reply box is disabled.
    await expect(page.getByRole('list', { name: 'Conversation' })).toBeVisible();
    await expect(page.getByText(note)).toHaveCount(0);
    await expect(page.getByText('INTERNAL NOTE')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Reply', exact: true })).toBeDisabled();
    await expect(page.getByText(/Read-only while Acting as/)).toBeVisible();

    // 3. Stop Acting as; open the Audit log.
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: `Stop acting as ${business}` }).click();
    await expect(page).toHaveURL(/\/app\/staff\//);
    await page.goto('/app/staff/audit-log');
    const entries = page.getByRole('table', { name: 'Audit log entries' }).getByRole('row');
    const noteEntry = entries
      .filter({ hasText: 'support.note_added' })
      .filter({ hasText: String(number) });
    await expect(noteEntry.first()).toBeVisible();
    const actingEntry = entries
      .filter({ hasText: 'acting_as.started' })
      .filter({ hasText: String(number) });
    await expect(actingEntry.first()).toBeVisible();
  } finally {
    await closeTicket(sam, number);
    await sam.dispose();
  }
});
