---
name: regression
description: Plans and evaluates regressions using historical QA data and current risk; requires current evidence.
compatibility: opencode
---

# Regression

## Approach

Use historical info to prioritize: recurring bugs, unstable areas, modified functionality, high-risk zones. Require current, verifiable evidence.

## Decision Inputs (before running)

A Regression is decided from: Risk, impact, affected area, dependencies, Memory, related Test Cases. Never run Regression indiscriminately.

Typical triggers: a Bug confirmed as fixed (after `retest`), changes in high-risk areas, reviewer recommendation, Memory showing recurring failures in an area (validated against current evidence).

## Retest relationship

When validating a fix, `retest` runs first (same affected scenario); its result and impact assessment feed this decision. Retest result ≠ Regression scope.

## Rules

- A historical bug is not confirmed current without current evidence
- Historical data is not current evidence by itself. Any use of qa/memory/ must be validated against current behavior and current evidence (see Memory Record Contract)
- NO EVIDENCE = NO CONFIRMED RESULT
- Risk-based prioritization
- Prefer reuse of stable test cases; verify expected still holds
- Differentiate tool called/requested → tool executed → execution_success → result obtained → result validated
- Never assert execution/validation without evidence; do not infer success from attempt alone
- Confidence HIGH/MEDIUM/LOW
- Reference qa/memory/ when relevant with explicit validation notes
