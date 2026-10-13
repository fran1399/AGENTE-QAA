import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Infrastructure smoke tests for the automation base.
 *
 * These tests are intentionally isolated from any real application:
 *  - the Web check renders a local HTML fixture, no network;
 *  - the API check talks to an ephemeral server bound to 127.0.0.1, no network.
 *
 * Their purpose is to prove that the toolchain works (browser launch, DOM
 * assertions, Playwright APIRequestContext), not to test a product.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(join(here, '..', 'fixtures', 'hello.html'), 'utf8');

test.describe('automation base / infrastructure smoke', () => {
  test('web: renders a local fixture in Chromium', async ({ page }) => {
    await page.setContent(fixtureHtml);
    await expect(page.getByRole('heading', { name: 'QA Agent automation base' })).toBeVisible();
    await expect(page.getByTestId('status')).toHaveText('ready');
  });

  test('api: Playwright request context reaches a local ephemeral server', async ({ request }) => {
    const server: Server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const response = await request.get(`http://127.0.0.1:${port}/health`);
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ ok: true, path: '/health' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
