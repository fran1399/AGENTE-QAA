---
name: error-handling
description: Standard error handling patterns for QA agents; how to report, recover from, and escalate errors without losing evidence.
compatibility: opencode
---

# Error Handling

## Purpose

Standard error handling patterns for all QA agents. Ensures errors are reported, evidence is preserved, and recovery is systematic.

## Error Categories

### 1. Tool Errors
- **Definition**: A tool call failed (timeout, crash, invalid input).
- **Response**: Report the error with full context. Do NOT retry blindly.
- **Evidence**: Capture the error message, stack trace (if any), and the tool input.

### 2. Validation Errors
- **Definition**: An artifact fails M-01 contract validation.
- **Response**: Report the validation errors. Do NOT proceed with consolidation.
- **Evidence**: The validation output with field-level errors.

### 3. Data Errors
- **Definition**: Test Data is missing, invalid, expired, or consumed.
- **Response**: Mark the affected Test Case as BLOCKED. Report the data issue.
- **Evidence**: The Test Data Record with its state and validation.

### 4. Infrastructure Errors
- **Definition**: The runner, Playwright, or the environment fails.
- **Response**: Report as TEST_INFRASTRUCTURE. Do NOT classify as APP_BUG.
- **Evidence**: The error message, exit code, and any logs.

### 5. Agent Errors
- **Definition**: An agent cannot complete its task (missing permissions, model unavailable, etc.).
- **Response**: Report the limitation. Mark affected conclusions as NOT_VERIFIED.
- **Evidence**: The specific error and what was being attempted.

## Error Response Pattern

```text
1. DETECT: Identify the error type and capture evidence.
2. REPORT: Log the error with full context (what, where, when).
3. CLASSIFY: Determine if it's recoverable or blocking.
4. RECOVER: If recoverable, apply the recovery strategy.
5. ESCALATE: If blocking, report to QA Lead with recommendations.
6. PRESERVE: Keep all evidence for later analysis.
```

## Recovery Strategies

| Error Type | Recovery | Escalation |
|---|---|---|
| Tool timeout | Retry once with longer timeout | If fails again, report as BLOCKED |
| Validation error | Fix the artifact if possible | If not fixable, report to QA Lead |
| Data missing | Request data from user | If unavailable, mark BLOCKED |
| Infra failure | Retry once | If fails again, report as TEST_INFRASTRUCTURE |
| Agent unavailable | Try alternative approach | If not possible, mark NOT_VERIFIED |

## Rules

- NO EVIDENCE = NO CONFIRMED RESULT: never hide an error without evidence.
- Never retry more than twice for the same error.
- Always preserve the original error message and context.
- Report errors in the user's language.
- Distinguish between "error occurred" and "error was handled".
- A recovered error is still reported (with the recovery evidence).
- Never present a recovered error as if it never happened.

## Output

When reporting an error, include:
- Error type and message
- What was being attempted
- Evidence captured
- Recovery attempted (if any)
- Current status (RECOVERED / BLOCKED / ESCALATED)
- Recommendation for next action
