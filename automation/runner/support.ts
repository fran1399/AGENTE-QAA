// Shared helpers for runner-managed automation (M-03).
//
// These helpers are imported by the automated specs (Playwright Test). The
// runner sets `QAA_TARGET_URL` before launching Playwright; a spec must never
// hardcode a target or print credential values.

import type { TestInfo } from '@playwright/test';

/** Base URL of the target application under test (set by the M-03 runner). */
export function targetUrl(): string {
  const t = (process.env.QAA_TARGET_URL ?? '').trim();
  if (!t) {
    throw new Error('QAA_TARGET_URL is not set (the M-03 runner sets it before launching Playwright)');
  }
  return t.replace(/\/+$/, '');
}

/** One explicit assertion performed by an automated Test Case. */
export interface AssertionItem {
  assertion: string;
  passed: boolean;
  detail?: string;
}

/** Records an explicit assertion so it can be attached as evidence. */
export function recordAssertion(assertions: AssertionItem[], assertion: string, passed: boolean, detail?: string): void {
  assertions.push({ assertion, passed, ...(detail ? { detail } : {}) });
}

/** Attaches the assertion log to the test so the runner promotes it to evidence. */
export async function attachAssertions(testInfo: TestInfo, assertions: AssertionItem[]): Promise<void> {
  await testInfo.attach('assertions.json', {
    contentType: 'application/json',
    body: JSON.stringify(assertions, null, 2),
  });
}