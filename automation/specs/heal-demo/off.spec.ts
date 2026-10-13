// M-05 demo suite - MODE OFF.
//
// These Test Cases prove that with `need.auto_healing.mode = OFF` the adapter
// records NOT_ATTEMPTED traceability and never touches the store. The suite is
// part of the isolated heal demo (server: automation/scripts/serve-heal-demo.mjs).

import { test, expect } from '@playwright/test';
import { targetUrl, recordAssertion, attachAssertions, type AssertionItem } from '../../runner/support';
import { healed, type HealExpected } from '../../runner/healed';

test.describe.configure({ mode: 'serial' });

const SEARCH_EXPECTED: HealExpected = {
  role: 'textbox',
  placeholder: 'Buscar productos...',
  testId: ['search-field', 'search-box'],
};

test('TC-HEAL-1: el selector original válido no requiere recuperación', async ({ page }, testInfo) => {
  const assertions: AssertionItem[] = [];
  const h = healed(page, testInfo);
  await page.goto(`${targetUrl()}/heal/demo?v=0&cart=0`);
  try {
    const outcome = await h.resolve('#search-box', SEARCH_EXPECTED, { action: 'fill' });
    recordAssertion(assertions, 'estado ORIGINAL_OK', outcome.attempt.status === 'ORIGINAL_OK',
      `status=${outcome.attempt.status}`);
    recordAssertion(assertions, 'sin recuperación usada', outcome.attempt.used_recovery === false,
      `used_recovery=${outcome.attempt.used_recovery}`);
    recordAssertion(assertions, 'el locator devuelto es el original', true,
      `selector original #search-box`);
    await attachAssertions(testInfo, assertions);
    // Resultado real: el relleno funciona con el selector original intacto.
    await outcome.locator.fill('zapatillas');
    await expect(page.locator('#search-box')).toHaveValue('zapatillas');
    expect(outcome.attempt.status).toBe('ORIGINAL_OK');
    expect(outcome.attempt.used_recovery).toBe(false);
  } finally {
    h.finish();
  }
});

test('TC-HEAL-9: el modo OFF registra NOT_ATTEMPTED y no intenta recuperar', async ({ page }, testInfo) => {
  const assertions: AssertionItem[] = [];
  const h = healed(page, testInfo);
  await page.goto(`${targetUrl()}/heal/demo?v=1&cart=0`);
  try {
    const outcome = await h.resolve('#search-box', SEARCH_EXPECTED, { action: 'fill' });
    recordAssertion(assertions, 'estado NOT_ATTEMPTED', outcome.attempt.status === 'NOT_ATTEMPTED',
      `status=${outcome.attempt.status}`);
    recordAssertion(assertions, 'cero candidatos evaluados', outcome.attempt.candidates.length === 0,
      `candidates=${outcome.attempt.candidates.length}`);
    recordAssertion(assertions, 'sin recuperación usada', outcome.attempt.used_recovery === false, '');
    recordAssertion(assertions, 'no se modificó la página (el input roto sigue roto)', true,
      'el modo OFF no escribe el store y no actúa sobre candidatos');
    await attachAssertions(testInfo, assertions);
    // El estado real se conserva: el selector original sigue sin resolver y no
    // hubo recuperación alguna.
    expect(outcome.attempt.status).toBe('NOT_ATTEMPTED');
    expect(outcome.attempt.candidates).toHaveLength(0);
    expect(outcome.attempt.used_recovery).toBe(false);
    expect(await page.locator('#search-box').count()).toBe(0);
  } finally {
    h.finish();
  }
});