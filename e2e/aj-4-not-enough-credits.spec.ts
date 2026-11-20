import type { Page } from '@playwright/test';
import { appOrigin, availableCredits, expect, test } from './fixtures.js';
import { businessIdOf, readRun, runIdFromUrl, staffApi } from './journeys.js';

/** Seeded (PRD section 8a): Corner Coffee Roasters, 120 credits, its Plan with max credits 400. */
const OWNER = 'low@demo.test';
const PLAN_ID = '00000000-0000-7000-8000-00000000d302';
const SEEDED_CREDITS = 120;

interface PlanView {
  guardrails: { maxCredits: number; maxLeads: number; minFitScore: number };
  lastRun: { id: string; status: string } | null;
}

async function readPlan(page: Page): Promise<PlanView> {
  const res = await page.request.get(`/api/plans/${PLAN_ID}`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as PlanView;
}

/**
 * On a fresh stack the seed is already the journey's starting point and this changes nothing.
 * A repeat on the same stack (the previous pass lowered the budget and spent credits) puts it
 * back: no run in progress, max credits 400, 120 credits available.
 */
async function backToSeededState(page: Page): Promise<void> {
  await expect
    .poll(async () => (await readPlan(page)).lastRun?.status ?? 'none', { timeout: 180_000 })
    .toMatch(/none|completed|failed|cancelled/);
  const plan = await readPlan(page);
  if (plan.guardrails.maxCredits !== 400) {
    const res = await page.request.patch(`/api/plans/${PLAN_ID}`, {
      data: { guardrails: { ...plan.guardrails, maxCredits: 400 } },
      headers: { Origin: appOrigin() },
    });
    expect(res.ok(), `reset max credits: ${res.status()}`).toBe(true);
  }
  const available = await availableCredits(page);
  if (available !== SEEDED_CREDITS) {
    const staff = await staffApi();
    try {
      const grant = await staff.post(`/api/staff/businesses/${await businessIdOf(page)}/credits`, {
        data: { credits: SEEDED_CREDITS - available, reason: 'AJ-4 repeat: back to the seed' },
      });
      expect(grant.status(), 'grant').toBe(201);
    } finally {
      await staff.dispose();
    }
    await expect.poll(() => availableCredits(page)).toBe(SEEDED_CREDITS);
  }
}

test('AJ-4: not enough credits offers a lower budget or buying credits @journey', async ({
  page,
  loginAs,
}) => {
  test.setTimeout(420_000);
  await loginAs(OWNER);
  await backToSeededState(page);

  // 1. The Business opens its Plan (max credits 400).
  await page.goto(`/app/plans/${PLAN_ID}`);
  await expect(page.getByLabel('Max credits')).toHaveValue('400');
  await expect(page.getByText('Available: 120 credits')).toBeVisible();

  // 2. Click "Find leads".
  await page.getByRole('button', { name: 'Find leads' }).click();

  // Expected: "You need 400 credits, you have 120" with the two ways out.
  const dialog = page.getByRole('dialog', { name: 'You need 400 credits, you have 120' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Buy credits' })).toBeVisible();

  // "Buy credits" leads to the Credits page; back on the Plan nothing has changed.
  await dialog.getByRole('button', { name: 'Buy credits' }).click();
  await expect(page).toHaveURL(/\/app\/credits$/);
  await page.goBack();
  await expect(page.getByLabel('Max credits')).toHaveValue('400');
  await page.getByRole('button', { name: 'Find leads' }).click();
  await expect(dialog).toBeVisible();

  // Choosing "Lower the budget" sets max credits to 120 and starting works.
  await dialog.getByRole('button', { name: 'Lower the budget to 120' }).click();
  await expect(page).toHaveURL(/\/app\/runs\/[0-9a-f-]{36}$/);
  const runId = runIdFromUrl(page);
  await expect(page.getByRole('list', { name: 'Research steps' })).toBeVisible();

  expect((await readPlan(page)).guardrails.maxCredits).toBe(120);
  expect((await readRun(page, runId)).creditsReserved).toBe(120);

  // Let the run end so it never overlaps the next journey's run.
  await expect
    .poll(async () => (await readRun(page, runId)).status, { timeout: 180_000 })
    .toMatch(/completed|failed|cancelled/);
});
