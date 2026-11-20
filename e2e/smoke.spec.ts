import { expect, test } from './fixtures.js';

test.describe('smoke', () => {
  test('the SPA loads at /app', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Llyner Leads' })).toBeVisible();
  });

  test('the API is healthy', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBe(true);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  test('the public site placeholder is served at /', async ({ request }) => {
    const res = await request.get('/');
    expect(res.ok()).toBe(true);
    expect(res.headers()['content-type']).toContain('text/html');
    expect(await res.text()).toContain('Llyner Leads');
  });
});
