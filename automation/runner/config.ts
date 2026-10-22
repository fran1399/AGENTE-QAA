// Playwright Test configuration used exclusively by the M-03 runner.
//
// The base configuration (playwright.config.ts) drives `npm test` for the
// infrastructure suite; this one is loaded by the runner when it executes the
// Test Cases of a suite (`node automation/.dist/runner/runner.js --suite ...`).
//
// It is decoupled from the base on purpose:
//   - the JSON reporter writes the machine-readable results the runner maps to
//     Test Cases (trace evidence, status, timing, attachments);
//   - the target URL and the run output dir come from the environment the
//     runner sets, never from the committed config.

import { defineConfig, devices } from '@playwright/test';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)), '..');
const out = resolve(process.env.QAA_RUNNER_OUT || join(repoRoot, 'automation', '.artifacts', 'runner-out'));

export default defineConfig({
  testDir: repoRoot,
  outputDir: join(out, 'pw'),
  forbidOnly: !!process.env.CI,
  // One execution per Test Case. An in-run retry would re-execute side effects
  // and duplicate M-05 evidence (the store written by attempt 1 turns attempt 2
  // into REUSED); the raw report keeps only the last attempt, so a retried PASS
  // would also be indistinguishable from a first-try PASS.
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: [
    ['line'],
    ['json', { outputFile: join(out, 'results.raw.json') }],
  ],
  use: {
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});