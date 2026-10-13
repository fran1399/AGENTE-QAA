---
name: qa-analysis
description: Analyzes QA objectives, scope, context, strategy and results following evidence-first and risk-based principles.
compatibility: opencode
---

# QA Analysis

## Flow

1. Identify objective
2. Define scope (in/out)
3. Separate facts vs assumptions
4. Identify risks
5. Define strategy
6. Determine required evidence
7. Evaluate results against evidence
8. Form conclusion with confidence

## Guidelines

- NO EVIDENCE = NO CONFIRMED RESULT
- expected/observed/evidence/conclusion/confidence
- Differentiate: tool called/requested → tool executed → execution_success → result obtained → result validated (do not infer success from attempt alone)
- Never assert execution/validation without evidence
- If uncertain: use INSUFFICIENT_EVIDENCE / BLOCKED / NOT_VERIFIED
- Validation proportional to risk
- Historical memory not treated as current evidence without current validation
