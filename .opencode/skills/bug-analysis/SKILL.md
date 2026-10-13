---
name: bug-analysis
description: Classifies every FAIL (APP_BUG/TEST_DATA/TEST_INFRASTRUCTURE/BLOCKED/INSUFFICIENT_EVIDENCE) before confirming Bugs, with reproducibility, severity, priority and evidence; avoids overreaching root cause.
compatibility: opencode
---

# Bug Analysis

## Failure Classification (before any Bug is confirmed)

Rule: **FAIL ≠ APP_BUG automatically.** Every FAIL is analyzed first (canonical contract: Failure Classification in AGENT-CONTRACTS.md).

- `APP_BUG` - sufficient evidence of a problem in the application under test
- `TEST_DATA` - result conditioned by invalid, nonexistent, expired, consumed or inadequate data
- `TEST_INFRASTRUCTURE` - problem belongs to the automation, runner, tool or infrastructure
- `BLOCKED` - necessary condition to execute or verify the Test Case does not exist
- `INSUFFICIENT_EVIDENCE` - an indication exists but evidence does not determine the cause

Analysis inputs: Expected Result, Actual Result, Evidence, Execution Traceability, Test Data, available context, Memory (historical, never current evidence).

Outcome: `TEST_FAILED` | `CAUSE_IDENTIFIED` | `BUG_CONFIRMED` | `BLOCKED` | `INSUFFICIENT_EVIDENCE`.

## Bug States

- CONFIRMED BUG
- LIKELY BUG
- POSSIBLE BUG
- NOT A BUG
- INSUFFICIENT EVIDENCE

## Severity/Priority

- Severity: CRITICAL / HIGH / MEDIUM / LOW
- Priority: P0 / P1 / P2 / P3

## Rules

- Require sufficient evidence to confirm
- possible_cause must be clearly marked hypothesis when uncertain
- NO EVIDENCE = NO CONFIRMED RESULT
- Confidence HIGH/MEDIUM/LOW
- Never assert execution/validation without evidence
- Link to specific evidence references
- Do not modify app code
- Historical data alone is not current evidence; validate against current evidence when using historical context
- A failure caused by data or infrastructure is never reported as an application Bug
