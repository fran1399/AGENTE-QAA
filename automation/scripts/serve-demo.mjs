#!/usr/bin/env node
// Minimal isolated demo server for the M-03 runner demo suites (Web + API).
// Uses only Node stdlib: serves the static fixture app and a tiny JSON API on
// 127.0.0.1. Port from argv[2] or PORT env (default 4173). No credentials,
// no external network, no extra dependencies.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)), 'fixtures', 'demo-app');
const PORT = Number(process.env.PORT ?? process.argv[2] ?? 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

// Shared catalog and order rules the API spec asserts against.
export const PRODUCTS = [
  { id: 'P-01', name: 'Zapatilla Urbana', price: 49999 },
  { id: 'P-02', name: 'Buzo Oversize', price: 39999 },
  { id: 'P-03', name: 'Gorra Snapback', price: 19999 },
  { id: 'P-04', name: 'Remera Básica', price: 14999 },
];
let orderSeq = 0;

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;

  if (pathname === '/api/health') return sendJson(res, 200, { ok: true, service: 'demo-qaa' });
  if (pathname === '/api/products') return sendJson(res, 200, { products: PRODUCTS });

  if (pathname === '/api/orders' && req.method === 'POST') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return sendJson(res, 400, { ok: false, error: 'invalid json' });
    }
    const product = PRODUCTS.find((p) => p.id === body.product_id);
    if (!product) {
      return sendJson(res, 400, { ok: false, error: 'unknown product', product_id: body.product_id });
    }
    const qty = body.qty;
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
      return sendJson(res, 400, { ok: false, error: 'invalid quantity', product_id: body.product_id, qty });
    }
    orderSeq += 1;
    return sendJson(res, 201, {
      ok: true,
      order_id: `ORD-${String(orderSeq).padStart(4, '0')}`,
      product_id: product.id,
      qty,
      total: product.price * qty,
    });
  }

  if (pathname.startsWith('/api/')) {
    return sendJson(res, 404, { ok: false, error: 'endpoint not found', path: pathname });
  }

  // Static files from the demo fixture app (path traversal guarded).
  let file = pathname === '/' ? '/index.html' : pathname;
  const safe = normalize(file).replace(/^(\.\.[/\\])+/, '');
  try {
    const data = await readFile(join(root, safe));
    res.writeHead(200, { 'content-type': MIME[extname(safe)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`demo server listening on http://127.0.0.1:${PORT}`);
});