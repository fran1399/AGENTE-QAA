# Validation Policy

## Evidence First

NO EVIDENCE = NO CONFIRMED RESULT.

## Confidence Levels

- HIGH: Direct, sufficient, reproducible evidence
- MEDIUM: Reasonable evidence with remaining uncertainty
- LOW: Hypothesis or incomplete evidence

## Risk-Based Validation

Validation effort must scale with impact/risk. Higher risk requires stronger evidence and more scrutiny.

## Risk Matrix (Double-Check)

Validation must be determined by defined risk criteria, not arbitrarily.

| Impact | Probability | Risk Level | Validation | QA Reviewer | Notes |
|---|---|---|---|---|---|
| CRITICAL | HIGH | CRITICAL | **OBLIGATORY** | **OBLIGATORY** before final conclusion | Decisions of High/Critical risk require QA Reviewer before final conclusion. |
| CRITICAL | MEDIUM | HIGH | **OBLIGATORY** | **OBLIGATORY** before final conclusion | High/Critical risk → mandatory independent review. |
| CRITICAL | LOW | HIGH | **OBLIGATORY** | **OBLIGATORY** before final conclusion | High/Critical risk → mandatory independent review. |
| HIGH | HIGH | HIGH | **OBLIGATORY** | **OBLIGATORY** before final conclusion | High/Critical risk → mandatory independent review. |
| HIGH | MEDIUM | MEDIUM | **RECOMMENDED** | **RECOMMENDED** | Additional scrutiny recommended. |
| HIGH | LOW | MEDIUM | **RECOMMENDED** | **RECOMMENDED** | Additional scrutiny recommended. |
| MEDIUM | HIGH | MEDIUM | **RECOMMENDED** | **RECOMMENDED** | Additional scrutiny recommended. |
| MEDIUM | MEDIUM | LOW | **OPTIONAL** | **OPTIONAL** | Normal validation per process. |
| MEDIUM | LOW | LOW | **OPTIONAL** | **OPTIONAL** | Normal validation per process. |
| LOW | HIGH | LOW | **OPTIONAL** | **OPTIONAL** | Normal validation per process. |
| LOW | MEDIUM | LOW | **OPTIONAL** | **OPTIONAL** | Normal validation per process. |
| LOW | LOW | LOW | **OPTIONAL** | **OPTIONAL** | Normal validation per process. |

## Independent Review

Critical/high-impact conclusions (critical/high bugs, release blockers, regression confirmations, destructive actions, GO/NO-GO) **require QA Reviewer before final conclusion** when risk is HIGH or CRITICAL (per Risk Matrix above). For MEDIUM risk, independent review is RECOMMENDED; for LOW, OPTIONAL. Feasibility must not remove the OBLIGATORY requirement when defined by this matrix.

## Tool Traceability

Track: tool called/requested → tool executed → execution_success (or failed) → result obtained → result validated. A successful tool call alone is insufficient to validate expected behavior. Execution must be verified; do not infer success from attempt alone.

## Prohibited Assertions

- Do not claim execution without performing it
- Do not claim validation without evidence
- Do not confuse symptom with cause without justification
- Do not treat historical findings as confirmed current state without current evidence
- Do not treat a FAIL as an APP_BUG without a Failure Classification (APP_BUG/TEST_DATA/TEST_INFRASTRUCTURE/BLOCKED/INSUFFICIENT_EVIDENCE)
- Do not start a relevant execution without a READY Pre-flight, or while ignoring a BLOCKED one
- Do not invent Test Data; do not report data as AVAILABLE without evidence
- Do not run Regression indiscriminately; it must be justified by risk, impact, affected area and dependencies
