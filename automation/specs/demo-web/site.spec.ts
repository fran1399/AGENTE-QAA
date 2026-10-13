// Automated Test Cases for the Web demo suite (M-03).
//
// Each `test()` matches exactly one entry in the suite manifest
// (automation/manifests/SUITE-demo-qaa-web.json) through `test_name`.
// Assertions are explicit `expect()` calls tied to the Expected Result of each
// Test Case; the assertion log is attached as evidence for the runner.
//
// The target comes from `QAA_TARGET_URL` (set by the runner): specs never
// hardcode the target and never print credentials.

import { test, expect, type TestInfo } from '@playwright/test';
import { targetUrl, recordAssertion, attachAssertions, type AssertionItem } from '../../runner/support';

test('home renders the product catalog', async ({ page }, testInfo: TestInfo) => {
  const assertions: AssertionItem[] = [];

  await page.goto(targetUrl());

  const heading = page.getByRole('heading', { name: 'Demo Store QA' });
  recordAssertion(assertions, 'heading "Demo Store QA" is visible', await heading.isVisible());
  await expect(heading).toBeVisible();

  const status = page.getByTestId('status');
  recordAssertion(assertions, 'status indicator reads "ready"', (await status.textContent())?.trim() === 'ready', await status.textContent() ?? '');
  await expect(status).toHaveText('ready');

  const products = page.getByTestId('product-list').locator('li');
  const count = await products.count();
  recordAssertion(assertions, 'catalog shows at least 3 products', count >= 3, `count=${count}`);
  await expect(products).toHaveCount(count);
  expect(count, 'catalog should have at least 3 products').toBeGreaterThanOrEqual(3);

  for (let i = 0; i < count; i += 1) {
    const name = await products.nth(i).getByTestId('product-name').textContent();
    const priceText = (await products.nth(i).getByTestId('product-price').textContent()) ?? '';
    const price = Number(priceText.replace(/[^0-9]/g, ''));
    recordAssertion(assertions, `product ${i} has a name`, !!name?.trim(), name ?? '');
    recordAssertion(assertions, `product ${i} has a positive price`, Number.isFinite(price) && price > 0, priceText);
  }

  await attachAssertions(testInfo, assertions);
});

test('add to cart updates the counter', async ({ page }, testInfo: TestInfo) => {
  const assertions: AssertionItem[] = [];

  await page.goto(targetUrl());

  const counter = page.getByTestId('cart-count');
  recordAssertion(assertions, 'cart starts at 0', (await counter.textContent())?.trim() === '0', await counter.textContent() ?? '');
  await expect(counter).toHaveText('0');

  await page.getByTestId('add-product').first().click();

  recordAssertion(assertions, 'cart counter shows 1 after adding a product', (await counter.textContent())?.trim() === '1', await counter.textContent() ?? '');
  await expect(counter).toHaveText('1');

  await attachAssertions(testInfo, assertions);
});