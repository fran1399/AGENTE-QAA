# M-06 — Data Verification Adapter (SQLite)

## Overview

M-06 provides a reusable, read-only database adapter for QA data verification. It allows a suite to declare SQL queries that are executed during the run, with results contrasted against expected conditions.

**Supported engines:** SQLite (via `node:sqlite`, native in Node.js 24+)

**Architecture:** The adapter is engine-agnostic at the interface level. Other engines (PostgreSQL, MySQL) can be added later without changing the QA core logic.

## Enabling the Adapter

The adapter is automatically available when a suite manifest declares `data_verifications`. No additional configuration is needed.

## Configuring a Demo Database

A script creates a temporary SQLite database with fictional data:

```bash
node automation/scripts/create-m06-demo-db.mjs [output_dir]
```

This creates:
- `demo.db` — SQLite database with `products`, `orders`, and `users` tables
- `manifest.json` — suite manifest with data verification requests

## Defining a Data Verification

Add a `data_verifications` array to the suite manifest:

```json
{
  "data_verifications": [
    {
      "verification_id": "DV-001",
      "description": "Check product count",
      "database": "automation/.runs/m06-demo/demo.db",
      "query": "SELECT COUNT(*) as cnt FROM products",
      "expected": { "type": "column_value", "column": "cnt", "value": 8, "operator": "=" }
    }
  ]
}
```

### Expected Condition Types

| Type | Description | Required Fields |
|------|-------------|-----------------|
| `row_count` | Compare number of rows returned | `count` |
| `column_value` | Compare a column value | `column`, `value`, `operator` (optional, default `=`) |
| `not_empty` | Expect at least one row | — |
| `empty` | Expect no rows | — |

### Operators (for `column_value`)

`=`, `!=`, `>`, `<`, `>=`, `<=`

### Parameters

Use `?` placeholders in the query and provide values in the `params` array:

```json
{
  "query": "SELECT COUNT(*) as cnt FROM products WHERE category = ?",
  "params": ["electronics"],
  "expected": { "type": "row_count", "count": 1 }
}
```

Parameter **values** are used only while the query executes and are never
persisted: the evidence records `params_bound: <n>` and the result's `params`
array carries one `<redacted>` placeholder per bound parameter (arity is kept,
values are not). The suite manifest remains the source for re-execution.

## Running the Demo Suite

```bash
# 1. Create the demo database and manifest
node automation/scripts/create-m06-demo-db.mjs

# 2. Run the suite
node automation/.dist/runner/runner.js \
  --manifest automation/.runs/m06-demo/manifest.json \
  --suite SUITE-m06-data-demo \
  --out automation/.runs/m06-demo-run
```

Expected output:
- 5 PASS / 1 FAIL / 0 ERROR (the FAIL is intentional to demonstrate failure handling)
- Exit code 1 (because of the failed verification)

## Interpreting Results

### Console Output

```
data verification: DV-M06-PRODUCTS-COUNT — TC-M06-WEB-1: Verify product count in database
  [PASS] DV-M06-PRODUCTS-COUNT
data verification: DV-M06-ACTIVE-ADMINS — Verify active admins count (expected: 1, but declared wrong as 2 to demo FAIL)
  [FAIL] DV-M06-ACTIVE-ADMINS: expected column 'cnt' = <redacted>, but the obtained value differs (values redacted)
data verifications: 5 PASS / 1 FAIL / 0 ERROR
```

### Files Generated

| File | Description |
|------|-------------|
| `data_verification.json` | M-01 contract: all verification results |
| `execution_trace.json` | Test Case traces with data verification info attached |
| `report.json` | Execution report including verification failures |
| `report.html` | Human-readable report |

### Report Integration

- Failed verifications increment `summary.failed` in `report.json`
- `overall_status` becomes `FAIL` if any verification fails
- Exit code is 1 if any verification fails

## Security Measures

### Query Validation (textual)

The adapter rejects queries containing:
- Write operations: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `REPLACE`
- Schema operations: `ATTACH`, `DETACH`, `PRAGMA`, `VACUUM`, `REINDEX`, `ANALYZE`
- Transaction control: `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `RELEASE`
- Privilege operations: `GRANT`, `REVOKE`, `TRIGGER`, `INDEX`, `TABLE`, `DATABASE`
- Multiple statements (semicolons)

Only `SELECT` and `WITH` statements are allowed.

### Engine-Level Protection

The database is opened with `readOnly: true` at the SQLite engine level. Even if a write query bypasses textual validation, the engine rejects it.

### Additional Safeguards

- Parameterized queries prevent SQL injection
- Row limit (default: 100) caps how many rows are used/evaluated. The full result
  set is still read from SQLite into memory **before** the limit is applied, so
  add `LIMIT` (or an aggregate) to the query to bound retrieval on large tables.
- `timeout_ms` (default: 5000) maps to `PRAGMA busy_timeout`: how long SQLite waits
  for a **locked** database before failing with `SQLITE_BUSY`. It is **not** a
  statement execution timeout — a long-running query is not interrupted.
- Query parameter values are never written to logs, reports or evidence; only the
  bound parameter count is recorded (`params_bound`).
- **Compared column values are never persisted.** For `column_value`, the obtained
  value and the expected `value` are used internally to execute and evaluate the
  comparison, but the result stores the placeholder `<redacted>` in `actual.column_value`
  and `expected.value`, and error messages never interpolate either value. The
  comparison outcome (`status`), the checked `column`, the `operator`, `column_found`
  and the evidence references are preserved, so a result remains auditable without
  disclosing the data it compared.
- No credentials or connection strings in logs/reports
- Only demo databases created for automated tests

## Pre-flight Integration

The adapter does not require pre-flight checks. The database path is resolved relative to the repository root, and connection errors are reported as verification `ERROR` status.

## Limitations

- **SQLite only:** PostgreSQL, MySQL, and other engines are not implemented yet
- **Read-only:** No write operations are supported (by design)
- **Single statement:** Only one query per verification (no multiple statements)
- **Row limit truncates the evaluated set:** when a query returns more than
  `max_rows` (default 100), only the first `max_rows` rows are evaluated, so
  `row_count`, `empty` and `not_empty` conditions apply to the truncated set. Use
  an aggregate or `LIMIT` in the query when the table can be large.
- **`timeout_ms` is a lock wait, not an execution timeout:** see Additional Safeguards.
- **node:sqlite experimental:** The `node:sqlite` module is experimental in Node.js 24 (works correctly but may change in future versions)

## Contract

The verification results follow the `data-verification` contract (M-01):

```json
{
  "verification_id": "DV-001",
  "description": "Check product count",
  "status": "PASS | FAIL | ERROR",
  "query": "SELECT COUNT(*) as cnt FROM products",
  "params": [],
  "rows_returned": 1,
  "duration_ms": 15,
  "expected": { "type": "column_value", "column": "cnt", "value": "<redacted>", "operator": "=" },
  "actual": { "row_count": 1, "column_value": "<redacted>", "column_found": true },
  "evidence": ["query: SELECT COUNT(*) as cnt FROM products", "rows_returned: 1", "duration_ms": 15"]
}
```

See `docs/AGENT-CONTRACTS.md` for the full contract definition.
