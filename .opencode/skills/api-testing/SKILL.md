---
name: api-testing
description: Executes and validates API/HTTP requests (status codes, headers, payloads) with verifiable evidence and traceability; independent adapter from Playwright.
compatibility: opencode
---

# API Testing

## Purpose

Execution adapter for API / HTTP, parallel and independent from `playwright-qa` (Web / PWA):

```text
QA Core
   ↓
Test Executor
   ├── playwright-qa → Web / PWA
   └── api-testing   → API / HTTP
```

QA Core does not depend on Playwright or on this adapter; particularities stay here.

## Capabilities

- Execute requests (method, URL, headers, body)
- Validate status codes, headers and payloads against the expected contract
- Capture Evidence: request/response artifacts saved under `qa/evidence/`
- Maintain Execution Traceability: request executed → response obtained → result validated
- Differentiate a request that was executed from a result that was validated

## Rules

- Never invent endpoints, contracts, authentication or responses; if the required information is not available: BLOCKED or INSUFFICIENT_EVIDENCE
- NO EVIDENCE = NO CONFIRMED RESULT: a completed request alone is not a validated result
- Differentiate: tool called → tool succeeded → result obtained → result validated
- No destructive or state-changing request without explicit authorization
- Requests run under Test Executor permissions (approval required by default)
- Failures observed through this adapter follow the same Failure Classification as UI failures (bug-analysis skill)
- Save artifacts to `qa/evidence/` with traceable references; never fabricate a response
