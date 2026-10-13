import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Test configuration for the reusable automation base (M-03 groundwork).
 *
 * Scope of this base: Web + API with a single tool (Playwright Test), so no
 * Axios/Newman duplication is introduced yet. Governance (contracts, evidence
 * rules, Failure Classification) stays in QA Core; this runner only *produces*
 * artifacts and evidence for the QA Agents to validate.
 *
 * Browsers: only Chromium is part of the initial technical base. Add Firefox/
 * WebKit on demand (`npm run browsers:install:all`).
 */
export default defineConfig({
  testDir: './automation/tests',
  outputDir: './automation/.artifacts/test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: './automation/.artifacts/playwright-report', open: 'never' }],
  ],
  use: {
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
