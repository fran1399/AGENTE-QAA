// M-05 demo suite - FAIL preservation (HIGH_CONFIDENCE mode).
//
// TC-HEAL-5 lives in its OWN spec file because it FAILS by design: the business
// assertion `#total-products` equals 7 while the demo variant v=6 truthfully
// renders 3. Keeping it isolated guarantees deterministic runs for the rest of
// the mechanism tests (serial mode stops on the first failure).

import { test, expect } from '@playwright/test';
import { targetUrl, recordAssertion, attachAssertions, type AssertionItem } from '../../runner/support';
import { healed, type HealExpected } from '../../runner/healed';

test.describe.configure({ mode: 'serial' });

const SEARCH_EXPECTED: HealExpected = {
  role: 'textbox',
  name: 'Búsqueda',
  placeholder: 'Buscar productos...',
  testId: ['search-field', 'search-box'],
};

test('TC-HEAL-5: un FAIL real se conserva aunque el selector se recupere', async ({ page }, testInfo) => {
  const assertions: AssertionItem[] = [];
  const h = healed(page, testInfo);
  await page.goto(`${targetUrl()}/heal/demo?v=6&cart=0`);
  try {
    const attempt = await h.fill('#search-box', 'zapatillas', SEARCH_EXPECTED, {
      mutating: true,
      outcome: async () => false,
      postVerify: async (p) => (await p.locator('[data-testid="search-field"]').inputValue()) === 'zapatillas',
    });
    recordAssertion(assertions, 'el selector se recupera', attempt.used_recovery === true,
      `status=${attempt.status} used_recovery=${attempt.used_recovery}`);
    recordAssertion(assertions, 'verificación posterior PASS', attempt.verification_after === 'POST_VERIFICATION_PASS',
      `verification=${attempt.verification_after}`);
    recordAssertion(assertions, 'el auto-healing NO cambia el resultado real', false,
      'la aserción de negocio sobre #total-products falla por diseño de la demo (3 != 7)');
    await attachAssertions(testInfo, assertions);
    // La recuperación solo seleccionó el locator: la aserción de negocio que
    // falla se conserva íntegra (Expected Results nunca cambian).
    expect(attempt.used_recovery).toBe(true);
    expect(attempt.ai_calls).toBe(0);
    await expect(page.locator('#total-products')).toHaveText('7');
  } finally {
    h.finish();
  }
});