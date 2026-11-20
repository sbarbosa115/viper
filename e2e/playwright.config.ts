import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  // One worker: journeys share the research queue, the fake Tools' error modes, the worker stop
  // hook and the Tool catalog (AJ-5, AJ-7, AJ-9), so they must not overlap.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]],
  outputDir: '../test-results',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
