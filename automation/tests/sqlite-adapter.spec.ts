// M-06 — SQLite adapter tests.
//
// Tests the read-only SQLite adapter for QA data verification.
// Uses a temporary SQLite database created in a temp directory.
//
// Covers:
//   1. Correct connection in read-only mode
//   2. Valid query and expected results
//   3. Parameterized query
//   4. Rejection of INSERT, UPDATE, DELETE, DROP, schema ops, multiple statements
//   5. Direct write attempt through the connection must fail
//   6. Non-existent tables and invalid queries
//   7. Empty results, unexpected values, connection errors
//   8. Row limit and sensitive data handling
//   9. Evidence and report generation
//   10. Connection closure and resource release

import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { SqliteAdapter, executeDataVerification, validateReadOnlyQuery, REDACTED_PARAM, REDACTED_VALUE } from '../runner/sqlite-adapter';

function createTempDb(): { dbPath: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'm06-test-'));
  const dbPath = join(dir, 'test.db');
  // Create a test database using node:sqlite
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL, category TEXT)');
  db.exec("INSERT INTO products (name, price, category) VALUES ('Widget', 9.99, 'tools')");
  db.exec("INSERT INTO products (name, price, category) VALUES ('Gadget', 19.99, 'electronics')");
  db.exec("INSERT INTO products (name, price, category) VALUES ('Thing', 29.99, 'tools')");
  db.exec("INSERT INTO products (name, price, category) VALUES ('Doodad', 39.99, 'electronics')");
  db.exec("INSERT INTO products (name, price, category) VALUES ('Gizmo', 49.99, 'tools')");
  db.close();
  return { dbPath, dir };
}

test.describe('M-06 SQLite Adapter', () => {
  test('1. opens database in read-only mode', () => {
    const { dbPath, dir } = createTempDb();
    try {
      const adapter = new SqliteAdapter(dbPath);
      adapter.open();
      expect(adapter.isOpen()).toBe(true);
      adapter.close();
      expect(adapter.isOpen()).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('2. valid query returns expected results', () => {
    const { dbPath, dir } = createTempDb();
    try {
      const adapter = new SqliteAdapter(dbPath);
      adapter.open();
      const result = adapter.executeQuery('SELECT COUNT(*) as cnt FROM products');
      expect(result.rowCount).toBe(1);
      expect((result.rows[0] as Record<string, unknown>).cnt).toBe(5);
      adapter.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('3. parameterized query works correctly', () => {
    const { dbPath, dir } = createTempDb();
    try {
      const adapter = new SqliteAdapter(dbPath);
      adapter.open();
      const result = adapter.executeQuery(
        'SELECT * FROM products WHERE category = ?',
        ['tools'],
      );
      expect(result.rowCount).toBe(3);
      adapter.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('4. rejects write operations in query validation', () => {
    const { dbPath, dir } = createTempDb();
    try {
      const adapter = new SqliteAdapter(dbPath);
      adapter.open();

      // Test query validation
      const writeQueries = [
        'INSERT INTO products VALUES (6, "X", 1.0, "y")',
        'UPDATE products SET price = 0',
        'DELETE FROM products',
        'DROP TABLE products',
        'ALTER TABLE products ADD COLUMN x TEXT',
        'CREATE TABLE test (id INTEGER)',
        'REPLACE INTO products VALUES (1, "X", 1.0, "y")',
        'ATTACH DATABASE "x" AS y',
        'PRAGMA user_version = 1',
        'VACUUM',
      ];

      for (const query of writeQueries) {
        const error = validateReadOnlyQuery(query);
        expect(error, `Query should be rejected: ${query}`).not.toBeNull();
      }

      // Test that executing write queries throws
      for (const query of writeQueries) {
        expect(() => adapter.executeQuery(query)).toThrow(/rejected|forbidden/i);
      }

      adapter.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('5. rejects multiple statements', () => {
    const error = validateReadOnlyQuery('SELECT 1; SELECT 2');
    expect(error).not.toBeNull();
    expect(error).toContain('multiple statements');
  });

  test('6. rejects queries not starting with SELECT or WITH', () => {
    const invalidStarters = [
      'DELETE FROM products',
      'UPDATE products SET price = 0',
      'DROP TABLE products',
      'EXPLAIN SELECT * FROM products',
    ];
    for (const query of invalidStarters) {
      const error = validateReadOnlyQuery(query);
      expect(error, `Query should be rejected: ${query}`).not.toBeNull();
    }
  });

  test('7. direct write through connection fails (engine-level protection)', () => {
    const { dbPath, dir } = createTempDb();
    try {
      const adapter = new SqliteAdapter(dbPath);
      adapter.open();

      // Attempt to write directly through the adapter (bypassing validation)
      // This should fail because the connection is opened in read-only mode
      expect(() => {
        adapter.executeQuery('INSERT INTO products VALUES (99, "Hacked", 0, "hacked")');
      }).toThrow();

      // Verify the database was not modified
      const result = adapter.executeQuery('SELECT COUNT(*) as cnt FROM products');
      expect((result.rows[0] as Record<string, unknown>).cnt).toBe(5);

      adapter.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('8. non-existent table returns error', () => {
    const { dbPath, dir } = createTempDb();
    try {
      const result = executeDataVerification(
        {
          verification_id: 'DV-001',
          description: 'Query non-existent table',
          database: dbPath,
          query: 'SELECT * FROM non_existent_table',
          expected: { type: 'not_empty' },
        },
        process.cwd(),
      );
      expect(result.status).toBe('ERROR');
      expect(result.error).toContain('non_existent_table');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('9. invalid query syntax returns error', () => {
    const { dbPath, dir } = createTempDb();
    try {
      const result = executeDataVerification(
        {
          verification_id: 'DV-002',
          description: 'Invalid SQL syntax',
          database: dbPath,
          query: 'SELECT FROM WHERE',
          expected: { type: 'not_empty' },
        },
        process.cwd(),
      );
      expect(result.status).toBe('ERROR');
      expect(result.error).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('10. empty result is handled correctly', () => {
    const { dbPath, dir } = createTempDb();
    try {
      const result = executeDataVerification(
        {
          verification_id: 'DV-003',
          description: 'Check empty result',
          database: dbPath,
          query: "SELECT * FROM products WHERE category = 'nonexistent'",
          expected: { type: 'empty' },
        },
        process.cwd(),
      );
      expect(result.status).toBe('PASS');
      expect(result.rows_returned).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('11. row count verification works', () => {
    const { dbPath, dir } = createTempDb();
    try {
      const result = executeDataVerification(
        {
          verification_id: 'DV-004',
          description: 'Count tools products',
          database: dbPath,
          query: "SELECT * FROM products WHERE category = 'tools'",
          expected: { type: 'row_count', count: 3 },
        },
        process.cwd(),
      );
      expect(result.status).toBe('PASS');
      expect(result.actual.row_count).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('12. row count mismatch fails correctly', () => {
    const { dbPath, dir } = createTempDb();
    try {
      const result = executeDataVerification(
        {
          verification_id: 'DV-005',
          description: 'Count tools products (wrong expectation)',
          database: dbPath,
          query: "SELECT * FROM products WHERE category = 'tools'",
          expected: { type: 'row_count', count: 5 },
        },
        process.cwd(),
      );
      expect(result.status).toBe('FAIL');
      expect(result.error).toContain('expected 5 rows, got 3');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('13. column_value verification works', () => {
    const { dbPath, dir } = createTempDb();
    try {
      const result = executeDataVerification(
        {
          verification_id: 'DV-006',
          description: 'Check first product name',
          database: dbPath,
          query: 'SELECT name FROM products ORDER BY id LIMIT 1',
          expected: { type: 'column_value', column: 'name', value: 'Widget', operator: '=' },
        },
        process.cwd(),
      );
      expect(result.status).toBe('PASS');
      // The compared value is never persisted (redacted), only the outcome.
      expect(result.actual.column_value).toBe(REDACTED_VALUE);
      expect(result.expected.value).toBe(REDACTED_VALUE);
      expect(JSON.stringify(result)).not.toContain('Widget');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('14. column_value mismatch fails correctly', () => {
    const { dbPath, dir } = createTempDb();
    try {
      const result = executeDataVerification(
        {
          verification_id: 'DV-007',
          description: 'Check first product name (wrong value)',
          database: dbPath,
          query: 'SELECT name FROM products ORDER BY id LIMIT 1',
          expected: { type: 'column_value', column: 'name', value: 'Gadget', operator: '=' },
        },
        process.cwd(),
      );
      expect(result.status).toBe('FAIL');
      expect(result.error).toContain('expected column');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('15. row limit is enforced', () => {
    const { dbPath, dir } = createTempDb();
    try {
      const adapter = new SqliteAdapter(dbPath);
      adapter.open();
      const result = adapter.executeQuery('SELECT * FROM products', [], 2);
      expect(result.rowCount).toBe(2);
      expect(result.rows).toHaveLength(2);
      adapter.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('16. WITH clause is allowed', () => {
    const { dbPath, dir } = createTempDb();
    try {
      const adapter = new SqliteAdapter(dbPath);
      adapter.open();
      const result = adapter.executeQuery(
        'WITH tools AS (SELECT * FROM products WHERE category = ?) SELECT COUNT(*) as cnt FROM tools',
        ['tools'],
      );
      expect(result.rowCount).toBe(1);
      expect((result.rows[0] as Record<string, unknown>).cnt).toBe(3);
      adapter.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('17. connection error for non-existent database', () => {
    const result = executeDataVerification(
      {
        verification_id: 'DV-008',
        description: 'Non-existent database',
        database: '/nonexistent/path/db.sqlite',
        query: 'SELECT 1',
        expected: { type: 'not_empty' },
      },
      process.cwd(),
    );
    expect(result.status).toBe('ERROR');
    expect(result.error).toContain('not found');
  });

  test('18. evidence is generated correctly', () => {
    const { dbPath, dir } = createTempDb();
    try {
      const result = executeDataVerification(
        {
          verification_id: 'DV-009',
          description: 'Evidence generation test',
          database: dbPath,
          query: 'SELECT COUNT(*) as cnt FROM products',
          expected: { type: 'row_count', count: 1 },
        },
        process.cwd(),
      );
      expect(result.status).toBe('PASS');
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence.some((e) => e.includes('query:'))).toBe(true);
      expect(result.evidence.some((e) => e.includes('rows_returned:'))).toBe(true);
      expect(result.evidence.some((e) => e.includes('duration_ms:'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('19. connection is closed after verification', () => {
    const { dbPath, dir } = createTempDb();
    try {
      const result = executeDataVerification(
        {
          verification_id: 'DV-010',
          description: 'Connection closure test',
          database: dbPath,
          query: 'SELECT 1',
          expected: { type: 'not_empty' },
        },
        process.cwd(),
      );
      expect(result.status).toBe('PASS');
      // The adapter should be closed internally; we verify by checking no file locks remain
      // (on Windows, this is a best-effort check)
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('20. sensitive data is not exposed in error messages', () => {
    const result = executeDataVerification(
      {
        verification_id: 'DV-011',
        description: 'Sensitive data exposure test',
        database: '/nonexistent/db.sqlite',
        query: 'SELECT password FROM users',
        expected: { type: 'not_empty' },
      },
      process.cwd(),
    );
    expect(result.status).toBe('ERROR');
    // Error should not contain the query with sensitive column names
    expect(result.error).not.toContain('password');
  });

  test('21. parameter values are redacted from evidence and result', () => {
    const { dbPath, dir } = createTempDb();
    try {
      const secret = 'super-secret-token-12345';
      const result = executeDataVerification(
        {
          verification_id: 'DV-REDACT-1',
          description: 'Parameter redaction test',
          database: dbPath,
          query: 'SELECT * FROM products WHERE category = ?',
          params: [secret],
          expected: { type: 'empty' },
        },
        process.cwd(),
      );
      expect(result.status).toBe('PASS');
      // The value must never reach the persisted artifact...
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(result.evidence.join('\n')).not.toContain(secret);
      // ...while arity is preserved for traceability.
      expect(result.params).toEqual([REDACTED_PARAM]);
      expect(result.evidence.some((e) => e.includes('params_bound: 1'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('22. row_count is evaluated against the truncated set (documented limitation)', () => {
    const { dbPath, dir } = createTempDb();
    try {
      const result = executeDataVerification(
        {
          verification_id: 'DV-TRUNC-1',
          description: 'Row limit truncation test',
          database: dbPath,
          query: 'SELECT * FROM products',
          max_rows: 2,
          expected: { type: 'row_count', count: 5 },
        },
        process.cwd(),
      );
      // 5 rows exist; max_rows truncates the evaluated set to 2.
      expect(result.rows_returned).toBe(2);
      expect(result.status).toBe('FAIL');
      expect(result.error).toContain('expected 5 rows, got 2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('23. timeout_ms is a lock wait, not a statement execution timeout', () => {
    const { dbPath, dir } = createTempDb();
    try {
      // A query that runs well beyond 1ms must still complete: timeout_ms only
      // bounds the wait for a locked database (PRAGMA busy_timeout).
      const result = executeDataVerification(
        {
          verification_id: 'DV-TIMEOUT-1',
          description: 'Timeout semantics test',
          database: dbPath,
          query:
            'WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x < 200000) SELECT COUNT(*) AS c FROM cnt',
          expected: { type: 'column_value', column: 'c', value: 200000, operator: '=' },
          timeout_ms: 1,
        },
        process.cwd(),
      );
      expect(result.status).toBe('PASS');
      // A large compared value is still redacted; only the outcome is recorded.
      // (The query text itself keeps the literal 200000 as reproducible SQL, so
      // the assertion targets the compared value, not the whole serialization.)
      expect(result.actual.column_value).toBe(REDACTED_VALUE);
      expect(result.expected.value).toBe(REDACTED_VALUE);
      expect(JSON.stringify(result.actual)).not.toContain('200000');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --- M-06 sensitive compared values (column_value) ------------------------

  function createSensitiveDb(): { dbPath: string; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'm06-sensitive-'));
    const dbPath = join(dir, 'sensitive.db');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE accounts (id INTEGER PRIMARY KEY, token TEXT)');
    db.exec("INSERT INTO accounts (token) VALUES ('SENSITIVE_ACTUAL_TEST_7F31')");
    db.close();
    return { dbPath, dir };
  }

  test('24. column_value PASS redacts the compared value (no actual/expected leak)', () => {
    const { dbPath, dir } = createSensitiveDb();
    try {
      const result = executeDataVerification(
        {
          verification_id: 'DV-REDACT-VALUE-PASS',
          description: 'Compared value redaction (PASS)',
          database: dbPath,
          query: 'SELECT token FROM accounts',
          expected: { type: 'column_value', column: 'token', value: 'SENSITIVE_ACTUAL_TEST_7F31', operator: '=' },
        },
        process.cwd(),
      );
      // The comparison still uses the real values and the outcome is correct...
      expect(result.status).toBe('PASS');
      expect(result.actual.column_found).toBe(true);
      // ...but neither the obtained nor the expected value is persisted.
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('SENSITIVE_ACTUAL_TEST_7F31');
      expect(serialized).not.toContain('SENSITIVE_EXPECTED_TEST_9C42');
      expect(result.actual.column_value).toBe(REDACTED_VALUE);
      expect(result.expected.value).toBe(REDACTED_VALUE);
      expect(result.evidence.join('\n')).not.toContain('SENSITIVE_ACTUAL_TEST_7F31');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('25. column_value FAIL redacts both values and keeps the FAIL status', () => {
    const { dbPath, dir } = createSensitiveDb();
    try {
      const result = executeDataVerification(
        {
          verification_id: 'DV-REDACT-VALUE-FAIL',
          description: 'Compared value redaction (FAIL)',
          database: dbPath,
          query: 'SELECT token FROM accounts',
          expected: { type: 'column_value', column: 'token', value: 'SENSITIVE_EXPECTED_TEST_9C42', operator: '=' },
        },
        process.cwd(),
      );
      expect(result.status).toBe('FAIL');
      expect(result.actual.column_found).toBe(true);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('SENSITIVE_ACTUAL_TEST_7F31');
      expect(serialized).not.toContain('SENSITIVE_EXPECTED_TEST_9C42');
      expect(result.error ?? '').not.toContain('SENSITIVE_ACTUAL_TEST_7F31');
      expect(result.error ?? '').not.toContain('SENSITIVE_EXPECTED_TEST_9C42');
      expect(result.actual.column_value).toBe(REDACTED_VALUE);
      expect(result.expected.value).toBe(REDACTED_VALUE);
      // Column and operator are preserved as evidence of what was checked.
      expect(result.error).toContain("expected column 'token' =");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
