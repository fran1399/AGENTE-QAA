// M-05 demo suite - MODE OBSERVE.
//
// TC-HEAL-10 proves that `need.auto_healing.mode = OBSERVE` identifies and
// records candidate selectors but never uses them: the test continues against
// the real DOM and the real result is preserved.

import { test, expect } from '@playwright/test';
import { targetUrl, recordAssertion, attachAssertions, type AssertionItem } from '../../runner/support';
import { healed, type HealExpected } from '../../runner/healed';

test.describe.configure({ mode: 'serial' });

const SEARCH_EXPECTED: HealExpected = {
  role: 'textbox',
  placeholder: 'Buscar productos...',
  testId: ['search-field', 'search-box'],
};

test('TC-HEAL-10: OBSERVE registra candidatos sin utilizarlos', async ({ page }, testInfo) => {
  const assertions: AssertionItem[] = [];
  const h = healed(page, testInfo);
  await page.goto(`${targetUrl()}/heal/demo?v=1&cart=0`);
  try {
    const outcome = await h.inspect('#search-box', SEARCH_EXPECTED, { action: 'fill' });
    recordAssertion(assertions, 'estado OBSERVED', outcome.attempt.status === 'OBSERVED',
      `status=${outcome.attempt.status}`);
    recordAssertion(assertions, 'candidatos identificados', outcome.attempt.candidates.length > 0,
      `candidates=${outcome.attempt.candidates.length}`);
    recordAssertion(assertions, 'ninguna recuperación usada', outcome.attempt.used_recovery === false,
      `used_recovery=${outcome.attempt.used_recovery}`);
    recordAssertion(assertions, 'el selector original sigue roto (no se actuó)', true,
      'OBSERVE nunca sustituye el locator y nunca escribe el store');
    await attachAssertions(testInfo, assertions);
    // El candidato existe en el DOM pero NO fue usado: el input sigue vacío.
    expect(outcome.attempt.status).toBe('OBSERVED');
    expect(outcome.attempt.used_recovery).toBe(false);
    expect(outcome.attempt.candidates.length).toBeGreaterThan(0);
    expect(await page.locator('#search-box').count()).toBe(0);
    await expect(page.locator('[data-testid="search-field"]')).toHaveValue('');
  } finally {
    h.finish();
  }
});