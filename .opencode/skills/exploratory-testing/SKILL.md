---
name: exploratory-testing
description: Performs risk-guided exploratory testing with clear separation of observation/hypothesis/evidence/conclusion.
compatibility: opencode
---

# Exploratory Testing

## Separation

OBSERVATION → HYPOTHESIS → EVIDENCE → CONCLUSION

## Focus Areas

States, boundaries, invalid inputs, navigation, errors, unexpected combinations.

## Rules

- Observation ≠ bug
- Gather evidence to confirm/refute
- expected vs observed when comparing states
- Confidence HIGH/MEDIUM/LOW
- NO EVIDENCE = NO CONFIRMED RESULT
- Differentiate: tool called/requested → tool executed → execution_success → result obtained → result validated (do not infer success from attempt alone)
- Never assert execution/validation without evidence
- Use INSUFFICIENT_EVIDENCE/BLOCKED/NOT_VERIFIED as needed
