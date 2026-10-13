---
name: test-data
description: Identifies, validates and tracks Test Data for Test Cases; detects missing, invalid, expired or consumed data and reports BLOCKED-by-data without inventing values.
compatibility: opencode
---

# Test Data

## Purpose

Reusable capability behind the Test Data Agent: know what data each Test Case needs, whether it exists and whether it is usable, with traceability. Preparation of data and execution of tests remain separate.

## States

- AVAILABLE (validated with evidence)
- MISSING
- INVALID
- EXPIRED
- CONSUMED
- UNVERIFIED (cannot be confirmed; never reported as AVAILABLE)
- NOT_APPLICABLE

## Flow

```text
Test Data → identification → validation → data available → Test Executor
```

## Rules

- NO EVIDENCE = NO CONFIRMED RESULT: AVAILABLE requires evidence
- Never invent credentials, IDs, business states or data values; request them instead
- Keep traceability Test Case ↔ Test Data (`test_data_id`, `test_case_ids`)
- Data preparation and test execution are separate responsibilities; execution belongs to Test Executor
- Missing, invalid or unusable data → the affected Test Case is BLOCKED with the reason
- Distinguish: data problem vs application problem (a FAIL caused by data is classified TEST_DATA, never APP_BUG)
- Confidence HIGH/MEDIUM/LOW; use UNVERIFIED when state cannot be confirmed
- Historical data is not current evidence; revalidate against current evidence
