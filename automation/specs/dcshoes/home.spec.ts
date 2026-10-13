// Automated port of Test Case TC-001 (suite TS-DC-001 DC Shoes): Home access & render.
//
// Read-only: page load, header/nav, search box and rendered products. No login,
// cart, checkout or order actions (respects the out_of_scope of TS-DC-001).
//
// The target comes from QAA_TARGET_URL (set by the M-03 runner): the spec never
// hardcodes the target and never prints credentials. Expected values derive from
// the original Test Case (qa/tests/dcshoes_tc.json) plus verifiable live
// observations of https://www.dcshoes.com.ar/.

import { test, expect, type TestInfo } from '@playwright/test';
import { targetUrl, recordAssertion, attachAssertions, type AssertionItem } from '../../runner/support';

test('TC-001 accede y renderiza el Home de DC Shoes', async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(120_000);
  const assertions: AssertionItem[] = [];

  // 1) Acceso: navegacion a la Home con respuesta HTTP valida
  const resp = await page.goto(targetUrl(), { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const navOk = resp !== null && resp.status() < 500;
  recordAssertion(assertions, 'Home responde con HTTP < 500', navOk, navOk ? `status=${resp!.status()}` : 'sin respuesta HTTP');

  const finalUrl = page.url();
  const urlOk = finalUrl.replace(/\/+$/, '') === 'https://www.dcshoes.com.ar';
  recordAssertion(assertions, 'URL final es la Home de DC Shoes', urlOk, `final URL: ${finalUrl}`);

  // 2) Titulo de la pestana (TC-001: 'DC Shoes | Skate & Snowboard')
  const title = await page.title();
  recordAssertion(assertions, "Titulo 'DC Shoes | Skate & Snowboard'", title === 'DC Shoes | Skate & Snowboard', `title: '${title}'`);

  // 3) Menu de navegacion (NEW ARRIVALS/HOMBRE/MUJER/NIÑOS/SKATE/SALE)
  const navTexts = await page.locator('header a, nav a').allTextContents();
  const normalized = navTexts.map((t) => t.replace(/\s+/g, ' ').trim());
  for (const label of ['New Arrivals', 'Hombre', 'Mujer', 'Niños', 'Skate', 'SALE']) {
    const found = normalized.includes(label);
    recordAssertion(assertions, `Menu contiene '${label}'`, found, found ? 'presente en header/nav' : 'NO encontrado');
  }
  recordAssertion(assertions, "Observacion: el menu actual posee ademas 'Snow' (no listado en TC-001)", normalized.includes('Snow'));

  // 4) Buscador operativo
  const search = page.locator('#search_mini_form input');
  const searchVisible = await search.isVisible();
  const placeholder = (await search.getAttribute('placeholder')) ?? '';
  recordAssertion(assertions, 'Buscador #search_mini_form visible y operativo', searchVisible, placeholder ? `placeholder: '${placeholder}'` : 'sin placeholder');
  recordAssertion(assertions, 'Placeholder del buscador presente', placeholder.length > 0, `valor real: '${placeholder}'`);

  // 5) Productos renderizados (TC-001: 'productos renderizados')
  const products = page.locator('li.product-item');
  const productCount = await products.count();
  recordAssertion(assertions, 'Listado de productos renderizado (>= 1 en DOM)', productCount >= 1, `productos detectados: ${productCount}`);
  const firstVisible = productCount > 0 ? await products.first().isVisible() : false;
  recordAssertion(assertions, 'Primer producto visible en pantalla', firstVisible, productCount > 0 ? 'primer .product-item visible' : 'sin productos');

  await attachAssertions(testInfo, assertions);

  // Cada assertion registrada debe cumplirse; el log queda completo aunque una falle.
  for (const a of assertions) {
    expect(a.passed, `${a.assertion}${a.detail ? ` — ${a.detail}` : ''}`).toBe(true);
  }
});