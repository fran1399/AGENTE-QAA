#!/usr/bin/env node
// Minimal isolated demo server for the M-05 auto-healing demo suites.
//
// Serves the heal demo app on 127.0.0.1:4174 (port from argv[2] or PORT env).
// The page renders DOM variants controlled by the query string:
//   /heal/demo?v=<0..8>&cart=<n>
//
// Variants (each one deterministically breaks/changes a different locator so
// the M-05 engine exercises one specific rule):
//   v=0  stable page:  #search-box present (selector original works)
//   v=1  #search-box -> input[data-testid="search-field"]   (RECOVERED rule:
//        stable test attribute wins)
//   v=2  #search-box -> input with ONLY a placeholder           (rule: unique
//        placeholder recovers)
//   v=3  TWO identical placeholder inputs                       (rule:
//        ambiguity -> AMBIGUOUS, no recovery)
//   v=4  data-testid="search-field" on a div[role=button]       (rule: same
//        attribute but DIFFERENT function -> REJECTED)
//   v=5  #search-box -> input[data-testid="quick-search"]       (rule: the
//        stored alternative [data-testid="search-field"] is stale -> invalidate
//        and recover with the new candidate)
//   v=6  like v=1 but #total-products=3 (assertion expects 7)   (rule: recovery
//        NEVER masks a real FAIL)
//   v=7  #buy-now -> button[data-testid="buy-now"]; the cart count is rendered
//        from ?cart= and only the button click increments it   (rule: mutation
//        guard / duplicate prevention)
//   v=8  the search area is a span with NO identity evidence   (rule: without
//        unique identity evidence -> NO_CANDIDATE, no recovery)
//
// Only Node stdlib is used: no credentials, no external network.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? process.argv[2] ?? 4174);

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function render(v, cart) {
  let searchArea;
  switch (Number(v)) {
    case 1:
      searchArea = '<input data-testid="search-field" class="search" placeholder="Buscar productos..." aria-label="Búsqueda" type="text">';
      break;
    case 2:
      searchArea = '<input name="q" class="search" placeholder="Buscar productos...">';
      break;
    case 3:
      searchArea =
        '<section id="quick-search"><input class="dup-a" placeholder="Buscar productos..."></section>' +
        '<section id="advanced-search"><input class="dup-b" placeholder="Buscar productos..."></section>';
      break;
    case 4:
      searchArea = '<div role="button" data-testid="search-field" class="widget" tabindex="0">Buscar</div>';
      break;
    case 5:
      searchArea = '<input data-testid="quick-search" class="search" placeholder="Buscar productos..." aria-label="Búsqueda" type="text">';
      break;
    case 6:
      searchArea = '<input data-testid="search-field" class="search" placeholder="Buscar productos..." aria-label="Búsqueda" type="text">';
      break;
    case 7:
      searchArea = '<input data-testid="search-field" class="search" placeholder="Buscar productos..." aria-label="Búsqueda" type="text">';
      break;
    case 8:
      searchArea = '<span class="widget">Consulta</span>';
      break;
    case 0:
    default:
      searchArea = '<input id="search-box" class="search" placeholder="Buscar productos..." aria-label="Búsqueda" type="text">';
      break;
  }

  const buyButton = Number(v) === 7
    ? '<button data-testid="buy-now">Comprar</button>'
    : '<button id="buy-now" class="buy-now">Comprar</button>';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Heal Demo (v=${esc(v)})</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; }
  .search { width: 22rem; padding: .5rem; }
  .widget { display: inline-block; padding: .5rem; border: 1px dashed #999; }
  .product { margin: .25rem 0; }
  section { margin: .75rem 0; }
</style>
</head>
<body>
  <h1>Tienda demo M-05 <small>v=${esc(v)}</small></h1>
  <form id="search-form" role="search">
    <label for="search-box-input">Búsqueda</label>
    ${searchArea}
  </form>
  <section id="catalog">
    <h2>Productos</h2>
    <ul id="product-list">
      <li class="product" data-product="P-01">Zapatilla Urbana</li>
      <li class="product" data-product="P-02">Buzo Oversize</li>
      <li class="product" data-product="P-03">Gorra Snapback</li>
    </ul>
    <p>Total de productos: <span id="total-products">3</span></p>
  </section>
  <section id="cart">
    <h2>Carrito</h2>
    <p>Unidades: <span id="cart-count">${esc(cart)}</span></p>
    ${buyButton}
  </section>
  <script>
    const cartCount = document.getElementById('cart-count');
    const targets = document.querySelectorAll('#buy-now, [data-testid="buy-now"]');
    for (const btn of targets) {
      btn.addEventListener('click', () => {
        cartCount.textContent = String(Number(cartCount.textContent || '0') + 1);
      });
    }
  </script>
</body>
</html>`;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  if (url.pathname === '/heal/demo') {
    const v = Number(url.searchParams.get('v') ?? 0);
    const cart = Number(url.searchParams.get('cart') ?? 0);
    if (v < 0 || v > 8) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('v must be 0..8');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(render(v, cart));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="es"><body><h1>Heal demo</h1><p>Usa <code>/heal/demo?v=0..8</code>.</p></body></html>`);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`heal demo server on http://127.0.0.1:${PORT}`);
});