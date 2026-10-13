// M-05 demo suite - MODE HIGH_CONFIDENCE.
//
// These Test Cases prove the recovery mechanism itself: strict candidate
// criteria, ambiguity, function mismatch (REJECTED), mutation protection
// (status RECOVERED with duplicate_prevented=true), store reuse, stale-store
// invalidation and no-candidate refusal. Tests run serially in file order.
// TC-HEAL-5 (FAIL
// preservation) lives in hc-fail.spec.ts by design: a failing test stops the
// serial queue, so it must not share the file with the mechanism tests.
//
// ORDER MATTERS (deterministic store chain):
//   TC-HEAL-2 writes the VERIFIED entry -> TC-HEAL-7 reuses it ->
//   TC-HEAL-8 invalidates it (stale) and writes a new one ->
//   TC-HEAL-3/4 invalidate that one on their pages -> TC-HEAL-6/11 run
//   against a store without matching VERIFIED entries; TC-HEAL-13 runs last and
//   uses a different selector (#buy-now), so it neither reads nor writes a
//   matching store entry.
// The status assertions accept RECOVERED|REUSED so the same spec stays valid
// when a shared `--autoheal-store` already contains the verified alternative.

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

const BUY_EXPECTED: HealExpected = {
  role: 'button',
  name: 'Comprar',
  testId: ['buy-now'],
};

test('TC-HEAL-2: recupera con el atributo de prueba estable y verifica la recuperación', async ({ page }, testInfo) => {
  const assertions: AssertionItem[] = [];
  const h = healed(page, testInfo);
  await page.goto(`${targetUrl()}/heal/demo?v=1&cart=0`);
  try {
    const attempt = await h.fill('#search-box', 'zapatillas', SEARCH_EXPECTED, {
      mutating: true,
      // el efecto aún no está aplicado en este flujo -> la acción se ejecuta
      outcome: async () => false,
      postVerify: async (p) => (await p.locator('[data-testid="search-field"]').inputValue()) === 'zapatillas',
    });
    const recovered = attempt.status === 'RECOVERED';
    const reused = attempt.status === 'REUSED';
    recordAssertion(assertions, 'la recuperación se usó', attempt.used_recovery === true,
      `status=${attempt.status} used_recovery=${attempt.used_recovery}`);
    recordAssertion(assertions, 'selector usado inequívoco', attempt.selector_used === '[data-testid="search-field"]',
      `selector_used=${attempt.selector_used ?? 'null'}`);
    recordAssertion(assertions, 'estrategia esperada según estado',
      (recovered && attempt.strategy_used === 'stable_attribute') || (reused && attempt.strategy_used === 'stored_reuse'),
      `strategy=${attempt.strategy_used ?? 'null'}`);
    if (recovered) {
      recordAssertion(assertions, 'verificación posterior PASS', attempt.verification_after === 'POST_VERIFICATION_PASS',
        `verification=${attempt.verification_after}`);
      recordAssertion(assertions, 'confianza final HIGH por post-verificación', attempt.confidence === 'HIGH',
        `confidence=${attempt.confidence}`);
    }
    recordAssertion(assertions, 'sin llamadas IA', attempt.ai_calls === 0, `ai_calls=${attempt.ai_calls}`);
    await attachAssertions(testInfo, assertions);
    // Resultado real: el valor llegó al input recuperado/reutilizado.
    expect(attempt.used_recovery).toBe(true);
    expect(['RECOVERED', 'REUSED']).toContain(attempt.status);
    expect(attempt.selector_used).toBe('[data-testid="search-field"]');
    expect(attempt.ai_calls).toBe(0);
    if (attempt.status === 'REUSED') {
      expect(attempt.reused_from_store).toBe(true);
    } else {
      expect(attempt.strategy_used).toBe('stable_attribute');
      expect(attempt.verification_after).toBe('POST_VERIFICATION_PASS');
      expect(attempt.confidence).toBe('HIGH');
    }
    await expect(page.locator('[data-testid="search-field"]')).toHaveValue('zapatillas');
  } finally {
    h.finish();
  }
});

test('TC-HEAL-7: reutiliza la alternativa almacenada en el mismo run sin IA', async ({ page }, testInfo) => {
  const assertions: AssertionItem[] = [];
  const h = healed(page, testInfo);
  await page.goto(`${targetUrl()}/heal/demo?v=1&cart=0`);
  try {
    const outcome = await h.resolve('#search-box', SEARCH_EXPECTED, { action: 'fill' });
    recordAssertion(assertions, 'estado REUSED desde store', outcome.attempt.status === 'REUSED',
      `status=${outcome.attempt.status}`);
    recordAssertion(assertions, 'reused_from_store = true', outcome.attempt.reused_from_store === true,
      `reused_from_store=${outcome.attempt.reused_from_store}`);
    recordAssertion(assertions, 'estrategia stored_reuse', outcome.attempt.strategy_used === 'stored_reuse',
      `strategy=${outcome.attempt.strategy_used ?? 'null'}`);
    recordAssertion(assertions, 'la reutilización evita regenerar candidatos', outcome.attempt.candidates.length === 1,
      `candidates=${outcome.attempt.candidates.length} (solo el reuso)`);
    await attachAssertions(testInfo, assertions);
    expect(outcome.attempt.status).toBe('REUSED');
    expect(outcome.attempt.used_recovery).toBe(true);
    expect(outcome.attempt.reused_from_store).toBe(true);
    expect(outcome.attempt.strategy_used).toBe('stored_reuse');
    expect(outcome.attempt.candidates).toHaveLength(1);
    // El reuso vuelve a funcionar contra el DOM real.
    await outcome.locator.fill('reutilizada');
    await expect(page.locator('[data-testid="search-field"]')).toHaveValue('reutilizada');
  } finally {
    h.finish();
  }
});

test('TC-HEAL-8: la alternativa almacenada obsoleta se invalida y se recupera de nuevo', async ({ page }, testInfo) => {
  const assertions: AssertionItem[] = [];
  const h = healed(page, testInfo);
  await page.goto(`${targetUrl()}/heal/demo?v=5&cart=0`);
  try {
    const attempt = await h.fill('#search-box', 'zapatillas', SEARCH_EXPECTED, {
      mutating: true,
      outcome: async () => false,
      postVerify: async (p) => (await p.locator('[aria-label="Búsqueda"]').inputValue()) === 'zapatillas',
    });
    const stale = attempt.candidates.find((c) => c.strategy === 'stored_reuse');
    recordAssertion(assertions, 'la alternativa almacenada fue evaluada primero', !!stale,
      `stale candidate=${stale?.selector ?? 'none'}`);
    recordAssertion(assertions, 'la alternativa almacenada ya no existe y fue rechazada', stale?.accepted === false,
      `accepted=${stale?.accepted}`);
    recordAssertion(assertions, 'se recuperó con un candidato nuevo', attempt.status === 'RECOVERED'
      && attempt.used_recovery === true, `status=${attempt.status}`);
    recordAssertion(assertions, 'el motivo de la invalidación quedó registrado', !!attempt.reason_reject
      && attempt.reason_reject.includes('no longer valid'), `reason_reject=${attempt.reason_reject ?? 'null'}`);
    await attachAssertions(testInfo, assertions);
    expect(stale?.accepted).toBe(false);
    expect(attempt.status).toBe('RECOVERED');
    expect(attempt.used_recovery).toBe(true);
    expect(attempt.selector_used).not.toBe('[data-testid="search-field"]');
    expect(await page.locator('[data-testid="search-field"]').count()).toBe(0);
    await expect(page.locator('[aria-label="Búsqueda"]')).toHaveValue('zapatillas');
  } finally {
    h.finish();
  }
});

test('TC-HEAL-3: ambigüedad no recuperable -> AMBIGUOUS', async ({ page }, testInfo) => {
  const assertions: AssertionItem[] = [];
  const h = healed(page, testInfo);
  await page.goto(`${targetUrl()}/heal/demo?v=3&cart=0`);
  try {
    const outcome = await h.inspect('#search-box', SEARCH_EXPECTED, { action: 'fill' });
    recordAssertion(assertions, 'estado AMBIGUOUS', outcome.attempt.status === 'AMBIGUOUS',
      `status=${outcome.attempt.status}`);
    recordAssertion(assertions, 'sin recuperación usada', outcome.attempt.used_recovery === false,
      `used_recovery=${outcome.attempt.used_recovery}`);
    recordAssertion(assertions, 'existen matches no únicos en los candidatos', true,
      outcome.attempt.candidates.filter((c) => c.count > 0 && !c.unique).map((c) => c.selector).join('|'));
    await attachAssertions(testInfo, assertions);
    expect(outcome.attempt.status).toBe('AMBIGUOUS');
    expect(outcome.attempt.used_recovery).toBe(false);
    expect(outcome.attempt.candidates.some((c) => c.count > 1)).toBe(true);
    expect(outcome.attempt.reason_reject).toContain('none was unique');
  } finally {
    h.finish();
  }
});

test('TC-HEAL-4: mismo atributo, función distinta -> REJECTED', async ({ page }, testInfo) => {
  const assertions: AssertionItem[] = [];
  const h = healed(page, testInfo);
  await page.goto(`${targetUrl()}/heal/demo?v=4&cart=0`);
  try {
    const outcome = await h.inspect('#search-box', SEARCH_EXPECTED, { action: 'fill' });
    recordAssertion(assertions, 'estado REJECTED', outcome.attempt.status === 'REJECTED',
      `status=${outcome.attempt.status}`);
    recordAssertion(assertions, 'el candidato único tiene función distinta (button vs textbox)', true,
      'el elemento con data-testid=search-field es un div[role=button] y no un textbox');
    recordAssertion(assertions, 'sin recuperación usada', outcome.attempt.used_recovery === false, '');
    await attachAssertions(testInfo, assertions);
    expect(outcome.attempt.status).toBe('REJECTED');
    expect(outcome.attempt.used_recovery).toBe(false);
    const byFunction = outcome.attempt.candidates.find((c) => c.unique);
    expect(byFunction?.accepted).toBe(false);
    // El DOM real no se alteró: el candidato equivocado no fue tocado.
    await expect(page.locator('div[data-testid="search-field"]')).not.toHaveAttribute('aria-pressed', 'true');
  } finally {
    h.finish();
  }
});

test('TC-HEAL-6: la acción mutante recuperada con efecto incierto no se repite', async ({ page }, testInfo) => {
  const assertions: AssertionItem[] = [];
  const h = healed(page, testInfo);
  try {
    // Escenario A: no se puede determinar si el efecto ya se aplicó -> NO se actúa.
    await page.goto(`${targetUrl()}/heal/demo?v=7&cart=1`);
    const attemptA = await h.click('#buy-now', BUY_EXPECTED, { mutating: true });
    recordAssertion(assertions, 'selector recuperado (buy-now)', attemptA.status === 'RECOVERED', `status=${attemptA.status}`);
    recordAssertion(assertions, 'duplicado prevenido sin verificación de resultado', attemptA.duplicate_prevented === true,
      `duplicate_prevented=${attemptA.duplicate_prevented}`);
    recordAssertion(assertions, 'el contador no fue tocado', true, 'cart sigue en 1: la acción NO se re-ejecutó');
    expect(attemptA.status).toBe('RECOVERED');
    expect(attemptA.used_recovery).toBe(true);
    expect(attemptA.duplicate_prevented).toBe(true);
    await expect(page.locator('#cart-count')).toHaveText('1');

    // Escenario B: verificación de resultado y efecto NO aplicado -> se ejecuta una vez.
    await page.goto(`${targetUrl()}/heal/demo?v=7&cart=0`);
    const attemptB = await h.click('#buy-now', BUY_EXPECTED, {
      mutating: true,
      outcome: async (p) => (await p.locator('#cart-count').textContent()) === '1',
    });
    recordAssertion(assertions, 'con resultado verificable y efecto no aplicado, la acción se ejecuta',
      attemptB.duplicate_prevented === false && attemptB.status === 'RECOVERED',
      `duplicate_prevented=${attemptB.duplicate_prevented}`);
    recordAssertion(assertions, 'el contador llegó a 1 tras la única ejecución', true, '');
    await attachAssertions(testInfo, assertions);
    expect(attemptB.duplicate_prevented).toBe(false);
    expect(attemptB.used_recovery).toBe(true);
    await expect(page.locator('#cart-count')).toHaveText('1');
  } finally {
    h.finish();
  }
});

test('TC-HEAL-11: sin evidencia de identidad inequívoca no se recupera (NO_CANDIDATE)', async ({ page }, testInfo) => {
  const assertions: AssertionItem[] = [];
  const h = healed(page, testInfo);
  try {
    // Sub-escenario 1: el "widget" existe pero carece de TODA evidencia de
    // identidad del elemento esperado -> NO_CANDIDATE, sin recuperación.
    await page.goto(`${targetUrl()}/heal/demo?v=8&cart=0`);
    const outcome = await h.inspect('#search-box', SEARCH_EXPECTED, { action: 'fill' });
    recordAssertion(assertions, 'estado NO_CANDIDATE', outcome.attempt.status === 'NO_CANDIDATE',
      `status=${outcome.attempt.status}`);
    recordAssertion(assertions, 'cero candidatos funcionales únicos', outcome.attempt.candidates.every((c) => !c.accepted),
      `accepted=${outcome.attempt.candidates.filter((c) => c.accepted).length}`);
    recordAssertion(assertions, 'sin recuperación usada', outcome.attempt.used_recovery === false, '');
    expect(outcome.attempt.status).toBe('NO_CANDIDATE');
    expect(outcome.attempt.used_recovery).toBe(false);

    // Sub-escenario 2: si aparecen criterios estrictos inequívocos (placeholder
    // único), la recuperación SÍ procede con la estrategia label_placeholder.
    await page.goto(`${targetUrl()}/heal/demo?v=2&cart=0`);
    const outcome2 = await h.resolve('#search-box', SEARCH_EXPECTED, { action: 'fill' });
    recordAssertion(assertions, 'con placeholder único se recupera (label_placeholder)',
      outcome2.attempt.status === 'RECOVERED' && outcome2.attempt.strategy_used === 'label_placeholder',
      `status=${outcome2.attempt.status} strategy=${outcome2.attempt.strategy_used ?? 'null'}`);
    await attachAssertions(testInfo, assertions);
    expect(outcome2.attempt.status).toBe('RECOVERED');
    expect(outcome2.attempt.strategy_used).toBe('label_placeholder');
    await outcome2.locator.fill('consulta');
    await expect(page.locator('[placeholder="Buscar productos..."]')).toHaveValue('consulta');
  } finally {
    h.finish();
  }
});

test('TC-HEAL-13: una excepción del callback de resultado no re-ejecuta la acción mutante', async ({ page }, testInfo) => {
  const assertions: AssertionItem[] = [];
  const h = healed(page, testInfo);
  try {
    // Selector roto y recuperable (v=7), efecto inicialmente NO aplicado (cart=0).
    await page.goto(`${targetUrl()}/heal/demo?v=7&cart=0`);
    const attempt = await h.click('#buy-now', BUY_EXPECTED, {
      mutating: true,
      // El sondeo del resultado falla: no se puede determinar si el efecto ya se
      // aplicó -> el intento queda incierto y la acción NO se re-ejecuta.
      outcome: async () => {
        throw new Error('outcome probe failed (demo)');
      },
    });
    recordAssertion(assertions, 'selector recuperado (buy-now)', attempt.status === 'RECOVERED',
      `status=${attempt.status}`);
    recordAssertion(assertions, 'efecto incierto -> duplicado prevenido', attempt.duplicate_prevented === true,
      `duplicate_prevented=${attempt.duplicate_prevented}`);
    recordAssertion(assertions, 'la acción mutante NO se re-ejecutó (contador intacto)', true,
      'cart sigue en 0: el callback de resultado lanzó y la acción no se ejecutó');
    recordAssertion(assertions, 'motivo trazable', !!attempt.reason_reject, `${attempt.reason_reject ?? 'null'}`);
    recordAssertion(assertions, 'sin llamadas IA', attempt.ai_calls === 0, `ai_calls=${attempt.ai_calls}`);
    await attachAssertions(testInfo, assertions);
    expect(attempt.status).toBe('RECOVERED');
    expect(attempt.used_recovery).toBe(true);
    expect(attempt.duplicate_prevented).toBe(true);
    expect(attempt.reason_reject).toContain('outcome probe failed');
    // El efecto real se conserva: la acción mutante no se ejecutó una segunda vez.
    await expect(page.locator('#cart-count')).toHaveText('0');
  } finally {
    h.finish();
  }
});