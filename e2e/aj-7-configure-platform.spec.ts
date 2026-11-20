import { expect, test } from './fixtures.js';
import { loginAsStaff, staffApi, uniqueSuffix, waitForEmail } from './journeys.js';

const YELP = { key: 'apify.yelp', name: 'Apify Yelp scraper' };
const PLACES = { key: 'google.places-text-search', name: 'Google Places Text Search' };

interface ToolRow {
  key: string;
  enabled: boolean;
  creditsPerUnit: number;
}

test('AJ-7: Staff configure email, the AI key and the Tools @journey', async ({
  page,
  mailpitUrl,
}) => {
  // Two Staff sign-ins (API setup, then the form); each may wait for a fresh TOTP window.
  test.setTimeout(150_000);
  const suffix = uniqueSuffix();
  const staff = await staffApi();
  const tools = (await (await staff.get('/api/staff/tools')).json()) as { items: ToolRow[] };
  const original = (key: string) => tools.items.find((t) => t.key === key);
  const places = original(PLACES.key);
  const yelp = original(YELP.key);
  expect(places && yelp, 'seeded tools').toBeTruthy();
  // A price the Rate card does not have yet, so the change is real on every repeat.
  const newPlacesCredits = (places?.creditsPerUnit ?? 0) === 5 ? 6 : 5;

  try {
    await loginAsStaff(page);

    // 1. /app/staff/settings → Email: set SMTP to Mailpit, "Send test email".
    await page.goto('/app/staff/settings');
    const email = page.getByRole('form', { name: 'Email (SMTP)' });
    await email.getByLabel('Host').fill('mailpit');
    await email.getByLabel('Port').fill('1025');
    await email.getByLabel('TLS').selectOption('none');
    await email.getByRole('button', { name: 'Save Email (SMTP)' }).click();
    await expect(email.getByText('Email (SMTP): Saved')).toBeVisible();

    const to = `ops-${suffix}@aj7.test`;
    await email.getByLabel('Send test email to').fill(to);
    await email.getByRole('button', { name: 'Send test email' }).click();
    await expect(email.getByRole('status').filter({ hasText: '●' })).toBeVisible({
      timeout: 20_000,
    });
    // Expected: the test email arrives.
    await waitForEmail(mailpitUrl, to, 'Test email');

    // 2. AI: replace the Anthropic key; only the last 4 characters show after saving.
    const last4 = suffix.slice(-4).padStart(4, '7');
    const key = `sk-ant-e2e-${suffix}-${last4}`;
    const ai = page.getByRole('form', { name: 'AI models' });
    await ai.getByRole('button', { name: 'Replace Anthropic API key' }).click();
    await ai.getByLabel('Anthropic API key new value').fill(key);
    await ai.getByRole('button', { name: 'Save AI models' }).click();
    await expect(ai.getByText('AI models: Saved')).toBeVisible();
    const keyGroup = ai.getByRole('group', { name: 'Anthropic API key' });
    await expect(keyGroup).toContainText(`••••${last4}`);
    // Expected: the key is masked, here and after a reload.
    await page.reload();
    await expect(page.getByRole('group', { name: 'Anthropic API key' })).toContainText(
      `••••${last4}`,
    );
    await expect(page.getByText(key)).toHaveCount(0);
    expect(await page.content()).not.toContain(key);

    // 3. Tools: disable "Apify Yelp scraper", change Places credits per unit.
    await page.goto('/app/staff/tools');
    const yelpSwitch = page.getByRole('switch', { name: `Enabled, ${YELP.name}` });
    await expect(yelpSwitch).toHaveAttribute('aria-checked', 'true');
    const placesRow = page.getByRole('row').filter({ hasText: PLACES.key });
    const marginBefore = (await placesRow.getByRole('cell').nth(5).textContent()) ?? '';
    await yelpSwitch.click();
    await page
      .getByRole('textbox', { name: `Credits per unit, ${PLACES.name}` })
      .fill(String(newPlacesCredits));
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved')).toBeVisible();

    // Expected: the Tool shows disabled and the new margin (after a reload, from the server).
    await page.reload();
    await expect(yelpSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(
      page.getByRole('textbox', { name: `Credits per unit, ${PLACES.name}` }),
    ).toHaveValue(new RegExp(`^${newPlacesCredits}(\\.0+)?$`));
    const marginAfter = (await placesRow.getByRole('cell').nth(5).textContent()) ?? '';
    expect(marginAfter).toMatch(/\d+%/);
    expect(marginAfter).not.toBe(marginBefore);

    // Expected: Audit log entries for the email settings, the AI settings and the Tools.
    await page.goto('/app/staff/audit-log');
    const entries = page.getByRole('table', { name: 'Audit log entries' }).getByRole('row');
    // Newest first: the two Tool changes, then AI, then email.
    const actions = async () =>
      (await entries.allTextContents())
        .slice(1, 5)
        .map((r) => /settings\.\w+\.updated|tool\.updated/.exec(r)?.[0] ?? r);
    await expect
      .poll(actions)
      .toEqual(['tool.updated', 'tool.updated', 'settings.ai.updated', 'settings.email.updated']);
    // The Details name the changed fields (the Target column shortens the Tool key).
    const toolRows = page.getByRole('row').filter({ hasText: 'tool.updated' });
    await expect(
      toolRows.filter({ hasText: '"enabled":{"to":false,"from":true}' }).first(),
    ).toBeVisible();
    await expect(
      toolRows.filter({ hasText: `"creditsPerUnit":{"to":${newPlacesCredits}` }).first(),
    ).toBeVisible();
  } finally {
    // Put the Rate card back so later journeys run on the seeded Tools.
    for (const t of [yelp, places]) {
      if (!t) continue;
      const res = await staff.patch(`/api/staff/tools/${t.key}`, {
        data: { enabled: t.enabled, creditsPerUnit: t.creditsPerUnit },
      });
      expect(res.ok(), `restore ${t.key}: ${res.status()}`).toBe(true);
    }
    await staff.dispose();
  }
});
