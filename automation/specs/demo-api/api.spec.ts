// Automated Test Cases for the API demo suite (M-03).
//
// Playwright Test is the engine for API Test Cases too (no Axios/Newman/other
// framework at this stage): requests and assertions run through the `request`
// fixture. Each `test()` matches exactly one manifest entry (SUITE-demo-qaa-api)
// through `test_name`, and the assertion log is attached as evidence.
//
// The base URL comes from `QAA_TARGET_URL` (set by the runner to the isolated
// demo server on 127.0.0.1). No credentials, no external network.

import { test, expect, type TestInfo, type APIRequestContext } from '@playwright/test';
import { targetUrl, recordAssertion, attachAssertions, type AssertionItem } from '../../runner/support';

async function statusAndJson(request: APIRequestContext, url: string) {
  const res = await request.get(url, { timeout: 5_000 });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status(), body };
}

test('GET /api/products returns the valid catalog', async ({ request }, testInfo: TestInfo) => {
  const assertions: AssertionItem[] = [];
  const base = targetUrl();

  const { status, body } = await statusAndJson(request, `${base}/api/products`);
  recordAssertion(assertions, 'GET /api/products returns HTTP 200', status === 200, `status=${status}`);
  expect(status).toBe(200);

  const products = (body as { products?: Array<{ id?: string; name?: string; price?: number }> })?.products ?? [];
  recordAssertion(assertions, 'response carries a products array of at least 3 items', Array.isArray(products) && products.length >= 3, `length=${products.length}`);
  expect(Array.isArray(products)).toBe(true);
  expect(products.length).toBeGreaterThanOrEqual(3);

  for (const [i, p] of products.entries()) {
    recordAssertion(assertions, `product ${i} has an id`, typeof p?.id === 'string' && p.id.length > 0, JSON.stringify(p));
    recordAssertion(assertions, `product ${i} has a name`, typeof p?.name === 'string' && p.name.length > 0, JSON.stringify(p));
    recordAssertion(assertions, `product ${i} has a positive price`, Number.isFinite(p?.price) && (p?.price ?? 0) > 0, JSON.stringify(p));
  }
  expect(products.every((p) => Number.isFinite(p?.price) && (p?.price ?? 0) > 0)).toBe(true);

  await attachAssertions(testInfo, assertions);
});

test('POST /api/orders validates business rules', async ({ request }, testInfo: TestInfo) => {
  const assertions: AssertionItem[] = [];
  const base = targetUrl();

  const valid = await request.post(`${base}/api/orders`, { data: { product_id: 'P-01', qty: 2 }, timeout: 5_000 });
  const validBody = (await valid.json()) as { ok?: boolean; order_id?: string; total?: number };
  recordAssertion(assertions, 'valid order returns HTTP 201', valid.status() === 201, `status=${valid.status()}`);
  expect(valid.status()).toBe(201);
  recordAssertion(assertions, 'valid order returns ok:true and an order_id', validBody.ok === true && typeof validBody.order_id === 'string' && validBody.order_id.startsWith('ORD-'), JSON.stringify(validBody));
  expect(validBody.ok).toBe(true);
  expect(validBody.order_id).toMatch(/^ORD-/);

  const unknown = await request.post(`${base}/api/orders`, { data: { product_id: 'NOPE', qty: 1 }, timeout: 5_000 });
  const unknownBody = (await unknown.json()) as { ok?: boolean; error?: string };
  recordAssertion(assertions, 'unknown product is rejected with HTTP 400 and ok:false', unknown.status() === 400 && unknownBody.ok === false && unknownBody.error === 'unknown product', `status=${unknown.status()} ${JSON.stringify(unknownBody)}`);
  expect(unknown.status()).toBe(400);
  expect(unknownBody.ok).toBe(false);

  const badQty = await request.post(`${base}/api/orders`, { data: { product_id: 'P-01', qty: 0 }, timeout: 5_000 });
  const badQtyBody = (await badQty.json()) as { ok?: boolean; error?: string };
  recordAssertion(assertions, 'invalid quantity is rejected with HTTP 400 and ok:false', badQty.status() === 400 && badQtyBody.ok === false && badQtyBody.error === 'invalid quantity', `status=${badQty.status()} ${JSON.stringify(badQtyBody)}`);
  expect(badQty.status()).toBe(400);
  expect(badQtyBody.ok).toBe(false);

  await attachAssertions(testInfo, assertions);
});