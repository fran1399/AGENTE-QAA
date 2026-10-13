// M-06 — Creates a temporary SQLite database with demo data for the
// SUITE-m06-data-demo suite. Run before executing the suite:
//   node automation/scripts/create-m06-demo-db.mjs
// The database and the suite manifest are placed in the --out directory.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

const outDir = process.argv[2] ?? join(REPO_ROOT, 'automation', '.runs', 'm06-demo');
mkdirSync(outDir, { recursive: true });

const dbPath = join(outDir, 'demo.db');

// Remove existing database to start fresh
try {
  const { rmSync } = await import('node:fs');
  rmSync(dbPath, { force: true });
} catch {
  // file does not exist — fine
}

const db = new DatabaseSync(dbPath);

// Create tables with fictional demo data
db.exec(`
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    category TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );
`);

// Insert fictional products
const products = [
  ['Mechanical Keyboard', 89.99, 'electronics', 15],
  ['USB-C Cable', 12.50, 'electronics', 100],
  ['Wireless Mouse', 45.00, 'electronics', 30],
  ['Desk Lamp', 35.00, 'furniture', 20],
  ['Notebook', 8.99, 'stationery', 200],
  ['Pen Set', 15.00, 'stationery', 50],
  ['Monitor Stand', 55.00, 'furniture', 10],
  ['Webcam', 75.00, 'electronics', 25],
];

for (const [name, price, category, stock] of products) {
  db.prepare('INSERT INTO products (name, price, category, stock) VALUES (?, ?, ?, ?)').run(name, price, category, stock);
}

// Insert fictional orders
const orders = [
  [1, 2, 'completed', '2026-10-01T10:00:00Z'],
  [2, 5, 'pending', '2026-10-02T14:30:00Z'],
  [3, 1, 'completed', '2026-10-03T09:15:00Z'],
  [4, 3, 'shipped', '2026-10-04T16:45:00Z'],
  [5, 10, 'completed', '2026-10-05T11:20:00Z'],
  [1, 1, 'pending', '2026-10-06T08:00:00Z'],
];

for (const [productId, quantity, status, createdAt] of orders) {
  db.prepare('INSERT INTO orders (product_id, quantity, status, created_at) VALUES (?, ?, ?, ?)').run(productId, quantity, status, createdAt);
}

// Insert fictional users
const users = [
  ['alice', 'alice@example.com', 'admin', 1],
  ['bob', 'bob@example.com', 'user', 1],
  ['charlie', 'charlie@example.com', 'user', 0],
  ['diana', 'diana@example.com', 'moderator', 1],
];

for (const [username, email, role, active] of users) {
  db.prepare('INSERT INTO users (username, email, role, active) VALUES (?, ?, ?, ?)').run(username, email, role, active);
}

db.close();

// Write the suite manifest that uses this database
const manifest = {
  suite_id: 'SUITE-m06-data-demo',
  app: 'demo-qaa',
  platform: 'web',
  adapter: 'playwright',
  web_server: {
    command: 'node automation/scripts/serve-demo.mjs 4197',
    url: 'http://127.0.0.1:4197/',
    timeout_ms: 15000,
  },
  requirements: {
    task: 'M-06 data verification demo',
    scope: 'SQLite read-only verification',
    platform: 'web',
    need: {
      runtime: { python: true, node: true, npm: true },
      adapters: ['playwright'],
      browsers: ['chromium'],
      tools: ['node', 'npm'],
      target: { url: 'http://127.0.0.1:4197/', method: 'GET', ok_status_max: 499, timeout_ms: 5000 },
      requires_evidence: true,
      qa_reviewer: { required: false },
      data_verification: { enabled: true },
    },
  },
  test_cases: [
    {
      test_case_id: 'TC-M06-WEB-1',
      title: 'Home page renders the product catalog',
      spec: 'automation/specs/demo-web/site.spec.ts',
      test_name: 'home renders the product catalog',
      expected_result: 'El catálogo muestra al menos 3 productos',
    },
  ],
  data_verifications: [
    {
      verification_id: 'DV-M06-PRODUCTS-COUNT',
      description: 'Verify product count in database',
      test_case_id: 'TC-M06-WEB-1',
      database: 'automation/.runs/m06-demo/demo.db',
      query: 'SELECT COUNT(*) as cnt FROM products',
      expected: { type: 'column_value', column: 'cnt', value: 8, operator: '=' },
    },
    {
      verification_id: 'DV-M06-ELECTRONICS-COUNT',
      description: 'Verify electronics category count',
      test_case_id: 'TC-M06-WEB-1',
      database: 'automation/.runs/m06-demo/demo.db',
      query: "SELECT COUNT(*) as cnt FROM products WHERE category = ?",
      params: ['electronics'],
      expected: { type: 'row_count', count: 1 },
    },
    {
      verification_id: 'DV-M06-LOW-STOCK',
      description: 'Verify low stock products exist',
      test_case_id: 'TC-M06-WEB-1',
      database: 'automation/.runs/m06-demo/demo.db',
      query: 'SELECT name, stock FROM products WHERE stock < ? ORDER BY stock ASC',
      params: [15],
      expected: { type: 'not_empty' },
    },
    {
      verification_id: 'DV-M06-COMPLETED-ORDERS',
      description: 'Verify completed orders count (expected: 3)',
      test_case_id: 'TC-M06-WEB-1',
      database: 'automation/.runs/m06-demo/demo.db',
      query: "SELECT COUNT(*) as cnt FROM orders WHERE status = ?",
      params: ['completed'],
      expected: { type: 'column_value', column: 'cnt', value: 3, operator: '=' },
    },
    {
      verification_id: 'DV-M06-ACTIVE-ADMINS',
      description: 'Verify active admins count (expected: 1, but declared wrong as 2 to demo FAIL)',
      test_case_id: 'TC-M06-WEB-1',
      database: 'automation/.runs/m06-demo/demo.db',
      query: "SELECT COUNT(*) as cnt FROM users WHERE role = ? AND active = ?",
      params: ['admin', 1],
      expected: { type: 'column_value', column: 'cnt', value: 2, operator: '=' },
    },
    {
      verification_id: 'DV-M06-EMPTY-CATEGORY',
      description: 'Verify non-existent category returns empty',
      test_case_id: 'TC-M06-WEB-1',
      database: 'automation/.runs/m06-demo/demo.db',
      query: "SELECT COUNT(*) as cnt FROM products WHERE category = ?",
      params: ['nonexistent'],
      expected: { type: 'column_value', column: 'cnt', value: 0, operator: '=' },
    },
  ],
};

const manifestPath = join(outDir, 'manifest.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

console.log(`Demo database created: ${dbPath}`);
console.log(`Suite manifest created: ${manifestPath}`);
console.log('');
console.log('Run the suite with:');
console.log(`  node automation/.dist/runner/runner.js --manifest ${manifestPath} --suite SUITE-m06-data-demo --out "${outDir}"`);
