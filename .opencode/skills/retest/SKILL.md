---
name: retest
description: Re-runs the affected scenario after a bug fix, records bug, Test Case, result, evidence and fix status, and feeds the impact assessment for Regression.
compatibility: opencode
---

# Retest

## Flow

```text
Bug fixed → Retest → validation of the fix → impact assessment → Regression when applicable
```

## What a Retest records

- Original Bug (`related_bug_id`)
- Related Test Case (`related_test_case_id`)
- Result: PASS / FAIL / BLOCKED / NOT VERIFIED
- Evidence (same standards as any execution)
- Fix status: FIXED / NOT_FIXED / INDETERMINATE

## Rules

- QA Lead coordinates; Test Executor performs the re-execution (only agent with execution capability)
- Same evidence and traceability standards as the original execution; never claim FIXED without current evidence
- A retest that cannot run is BLOCKED or NOT VERIFIED, never PASS
- After the retest, assess impact: risk, affected area, dependencies, Memory, related Test Cases
- Regression is decided from that assessment (see `regression` skill); never run Regression indiscriminately
- Historical memory is not current evidence; the retest itself is the current evidence
- Confidence HIGH/MEDIUM/LOW
