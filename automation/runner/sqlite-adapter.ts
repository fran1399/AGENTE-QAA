// M-06 — Read-only SQLite adapter for QA data verification.
//
// Provides a safe, reusable interface to query a SQLite database during a QA
// test run and contrast obtained data with expected conditions.
//
// Security guarantees:
//   - Opens the database in READ-ONLY mode at the engine level (not just text).
//   - Rejects any query containing write/schema keywords (INSERT, UPDATE, DELETE,
//     DROP, ALTER, CREATE, REPLACE, ATTACH, DETACH, PRAGMA, VACUUM, etc.).
//   - Rejects multiple statements (only one SELECT/WITH allowed).
//   - Uses parameterized queries for dynamic values.
//   - Limits the number of rows returned (the full result set is still read from
//     SQLite into memory first, so add LIMIT to the query to bound retrieval).
//   - Sets a busy timeout that bounds how long SQLite waits for a locked
//     database; it is NOT a statement execution timeout.
//   - Never persists credentials, connection strings, query parameter VALUES or
//     compared column VALUES in logs/reports/evidence: parameter arity is kept
//     and comparison values are redacted (only the comparison outcome remains).
//
// The adapter is engine-agnostic at the interface level: other engines can be
// added later without changing the QA core logic.

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// --------------------------------------------------------------------------- //
// Types
// --------------------------------------------------------------------------- //

export interface DataVerificationRequest {
  /** Unique identifier for this verification. */
  verification_id: string;
  /** Human-readable description of what is being verified. */
  description: string;
  /** Optional explicit link to a Test Case ID. Use this for stable association. */
  test_case_id?: string;
  /** Path to the SQLite database file (repo-relative or absolute). */
  database: string;
  /** Read-only SQL query (single SELECT/WITH statement). */
  query: string;
  /** Optional parameters for the query (positional ? placeholders). Values are
   *  used only during execution and are never persisted (see redactParamValues). */
  params?: unknown[];
  /** Expected result condition. */
  expected: ExpectedCondition;
  /** Maximum rows to return (default: 100). */
  max_rows?: number;
  /** Query timeout in milliseconds (default: 5000). */
  timeout_ms?: number;
}

export interface ExpectedCondition {
  /** Condition type. */
  type: 'row_count' | 'column_value' | 'not_empty' | 'empty';
  /** Expected row count (for row_count). */
  count?: number;
  /** Column name to check (for column_value). */
  column?: string;
  /** Expected value (for column_value). */
  value?: unknown;
  /** Comparison operator (for column_value). Default: '='. */
  operator?: '=' | '!=' | '>' | '<' | '>=' | '<=';
}

export interface DataVerificationResult {
  verification_id: string;
  description: string;
  status: 'PASS' | 'FAIL' | 'ERROR';
  query: string;
  /** Arity of the bound parameters is preserved, but values are redacted. */
  params?: unknown[];
  rows_returned: number;
  duration_ms: number;
  expected: ExpectedCondition;
  actual: {
    row_count?: number;
    column_value?: unknown;
    column_found?: boolean;
  };
  error?: string;
  evidence: string[];
}

// --------------------------------------------------------------------------- //
// Security: query validation
// --------------------------------------------------------------------------- //

/** Keywords that indicate a write or schema operation. */
const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'REPLACE',
  'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM', 'REINDEX', 'ANALYZE',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE',
  'GRANT', 'REVOKE', 'TRIGGER', 'INDEX', 'TABLE', 'DATABASE',
];

/** Allowed query starters. */
const ALLOWED_STARTERS = ['SELECT', 'WITH'];

/**
 * Validates that a query is a safe read-only statement.
 * Returns an error message if the query is not safe, or null if it is.
 */
export function validateReadOnlyQuery(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return 'query is empty';

  // Reject multiple statements (semicolons outside of strings)
  const withoutStrings = trimmed.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  if (withoutStrings.includes(';')) return 'multiple statements are not allowed';

  // Check allowed starter
  const firstWord = withoutStrings.split(/\s+/)[0]?.toUpperCase() ?? '';
  if (!ALLOWED_STARTERS.includes(firstWord)) {
    return `query must start with SELECT or WITH (got '${firstWord}')`;
  }

  // Check forbidden keywords (word-boundary match)
  const upperQuery = withoutStrings.toUpperCase();
  for (const keyword of FORBIDDEN_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(upperQuery)) {
      return `forbidden keyword '${keyword}' detected`;
    }
  }

  return null;
}

// --------------------------------------------------------------------------- //
// SQLite adapter
// --------------------------------------------------------------------------- //

export interface SqliteAdapterConfig {
  /** Default max rows to return. */
  default_max_rows?: number;
  /** Default query timeout in ms. */
  default_timeout_ms?: number;
}

/**
 * Read-only SQLite adapter for QA data verification.
 * Opens the database in READ-ONLY mode at the engine level.
 */
export class SqliteAdapter {
  private db: DatabaseSync | null = null;
  private dbPath: string;
  private config: Required<SqliteAdapterConfig>;

  constructor(databasePath: string, config: SqliteAdapterConfig = {}) {
    this.dbPath = resolve(databasePath);
    this.config = {
      default_max_rows: config.default_max_rows ?? 100,
      default_timeout_ms: config.default_timeout_ms ?? 5000,
    };
  }

  /**
   * Opens the database in READ-ONLY mode.
   * Throws if the file does not exist or cannot be opened.
   */
  open(): void {
    if (this.db) return; // already open
    if (!existsSync(this.dbPath)) {
      throw new Error(`database file not found: ${this.dbPath}`);
    }
    // Open in READ-ONLY mode at the engine level.
    // The readOnly option is not yet in @types/node, so we cast.
    this.db = new DatabaseSync(this.dbPath, { readOnly: true } as Record<string, unknown>);
  }

  /**
   * Executes a read-only query and returns the results.
   * Validates the query, applies row limit and timeout.
   */
  executeQuery(
    query: string,
    params: unknown[] = [],
    maxRows?: number,
    timeoutMs?: number,
  ): { rows: Record<string, unknown>[]; rowCount: number; durationMs: number } {
    if (!this.db) {
      throw new Error('database not open — call open() first');
    }

    // Security: validate query is read-only
    const validationError = validateReadOnlyQuery(query);
    if (validationError) {
      throw new Error(`query rejected: ${validationError}`);
    }

    const limit = maxRows ?? this.config.default_max_rows;
    const timeout = timeoutMs ?? this.config.default_timeout_ms;

    const startTime = Date.now();

    try {
      // Set a busy timeout to avoid hanging
      this.db.exec(`PRAGMA busy_timeout = ${timeout};`);

      // Prepare and execute the query with parameters
      const stmt = this.db.prepare(query);
      const rows = stmt.all(...(params as never[])) as Record<string, unknown>[];

      // Apply row limit
      const limitedRows = rows.slice(0, limit);

      const durationMs = Date.now() - startTime;
      return { rows: limitedRows, rowCount: limitedRows.length, durationMs };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`query execution failed after ${durationMs}ms: ${message}`);
    }
  }

  /**
   * Closes the database connection and releases resources.
   */
  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // ignore close errors
      }
      this.db = null;
    }
  }

  /**
   * Returns true if the database connection is open.
   */
  isOpen(): boolean {
    return this.db !== null;
  }
}

// --------------------------------------------------------------------------- //
// Verification logic
// --------------------------------------------------------------------------- //

/** Placeholder written in place of every query parameter value. */
export const REDACTED_PARAM = '<redacted>';

/** Placeholder written in place of a compared value (obtained or expected). */
export const REDACTED_VALUE = '<redacted>';

/**
 * Replaces query parameter values with a placeholder, preserving the number of
 * bound parameters. Arity is useful for traceability; the values are not, and
 * they may carry credentials or other sensitive data that must never reach an
 * evidence artifact. The original values remain available in the suite manifest
 * (the reproducible source), so nothing needed for re-execution is lost.
 */
export function redactParamValues(params?: unknown[]): string[] {
  return (params ?? []).map(() => REDACTED_PARAM);
}

/**
 * Returns a copy of the expected condition with the compared value replaced by a
 * placeholder. The type/column/operator/count are preserved (they are needed to
 * prove what was checked), while the value — which may be sensitive — is not
 * persisted. The original value is still used to evaluate the comparison.
 */
export function redactExpectedValue(expected: ExpectedCondition): ExpectedCondition {
  return expected.value === undefined ? { ...expected } : { ...expected, value: REDACTED_VALUE };
}

/**
 * Executes a data verification request and returns the result.
 * This is the main entry point for QA data verification.
 */
export function executeDataVerification(
  request: DataVerificationRequest,
  repoRoot: string,
): DataVerificationResult {
  const startTime = Date.now();
  const evidence: string[] = [];

  const dbPath = resolve(repoRoot, request.database);
  const adapter = new SqliteAdapter(dbPath);
  // Redacted copy used only for persistence; the real values still drive the
  // execution and the comparison below.
  const redactedExpected = redactExpectedValue(request.expected);

  try {
    adapter.open();

    const { rows, rowCount, durationMs } = adapter.executeQuery(
      request.query,
      request.params ?? [],
      request.max_rows,
      request.timeout_ms,
    );

    // Evaluate expected condition
    const actual: DataVerificationResult['actual'] = { row_count: rowCount };
    let status: 'PASS' | 'FAIL' | 'ERROR' = 'PASS';
    let error: string | undefined;

    const expected = request.expected;

    switch (expected.type) {
      case 'row_count': {
        if (rowCount !== expected.count) {
          status = 'FAIL';
          error = `expected ${expected.count} rows, got ${rowCount}`;
        }
        break;
      }
      case 'not_empty': {
        if (rowCount === 0) {
          status = 'FAIL';
          error = 'expected non-empty result, got 0 rows';
        }
        break;
      }
      case 'empty': {
        if (rowCount > 0) {
          status = 'FAIL';
          error = `expected empty result, got ${rowCount} rows`;
        }
        break;
      }
      case 'column_value': {
        const column = expected.column;
        const operator = expected.operator ?? '=';
        if (!column) {
          status = 'ERROR';
          error = 'column_value condition requires a column name';
          break;
        }
        if (rowCount === 0) {
          status = 'FAIL';
          error = `expected column '${column}' ${operator} ${REDACTED_VALUE}, but result is empty`;
          break;
        }
        const actualValue = rows[0][column];
        const columnFound = column in rows[0];
        // The obtained value may be sensitive: the comparison still runs against
        // the real value, but only the outcome is persisted.
        actual.column_value = REDACTED_VALUE;
        actual.column_found = columnFound;

        if (!columnFound) {
          status = 'FAIL';
          error = `column '${column}' not found in result`;
        } else if (!evaluateOperator(actualValue, expected.value, operator)) {
          status = 'FAIL';
          error = `expected column '${column}' ${operator} ${REDACTED_VALUE}, but the obtained value differs (values redacted)`;
        }
        break;
      }
    }

    // Record evidence
    evidence.push(`query: ${request.query}`);
    if (request.params && request.params.length > 0) {
      evidence.push(`params_bound: ${request.params.length}`);
    }
    evidence.push(`rows_returned: ${rowCount}`);
    evidence.push(`duration_ms: ${durationMs}`);
    if (error) {
      evidence.push(`error: ${error}`);
    }

    return {
      verification_id: request.verification_id,
      description: request.description,
      status,
      query: request.query,
      params: redactParamValues(request.params),
      rows_returned: rowCount,
      duration_ms: Date.now() - startTime,
      expected: redactedExpected,
      actual,
      error,
      evidence,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      verification_id: request.verification_id,
      description: request.description,
      status: 'ERROR',
      query: request.query,
      params: redactParamValues(request.params),
      rows_returned: 0,
      duration_ms: Date.now() - startTime,
      expected: redactedExpected,
      actual: { row_count: 0 },
      error: message,
      evidence: [...evidence, `error: ${message}`],
    };
  } finally {
    adapter.close();
  }
}

/**
 * Evaluates a comparison operator for expected conditions.
 */
function evaluateOperator(actual: unknown, expected: unknown, operator: string): boolean {
  switch (operator) {
    case '=': return actual === expected;
    case '!=': return actual !== expected;
    case '>': return Number(actual) > Number(expected);
    case '<': return Number(actual) < Number(expected);
    case '>=': return Number(actual) >= Number(expected);
    case '<=': return Number(actual) <= Number(expected);
    default: return false;
  }
}
