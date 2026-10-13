---
name: pre-flight
description: Verifies necessary conditions (target, credentials, tools, adapters, Test Data, config, reviewer) before a relevant execution via an executable detector and returns READY or BLOCKED with causes.
compatibility: opencode
---

# Pre-flight

## Purpose

Reusable checklist applied by Test Executor (and ordered by QA Lead) before a relevant execution. It prevents starting a run when a necessary condition is already blocked. The checks are executed by a deterministic detector that emits a `pre-flight-record` (validated by M-01); Pre-flight itself never executes Test Cases.

## Execution

```bash
python qa/tools/preflight.py --requirements <requirements.json> [--out <record.json>] [--json]
```

- Exit `0` = `READY`, exit `1` = `BLOCKED`, exit `2` = fatal/invalid record.
- The requirements file declares what the task needs (`need`): runtime, node packages, adapters, browsers, tools, target, credentials, config, Test Data, evidence dir and QA Reviewer requirement.
- The produced record is validated against `pre-flight-record` (M-01) before use.
- Format, vocabulary, mapping and examples: `docs/PRE-FLIGHT-CAPABILITIES.md`.

## Checks

- Runtime: Python / Node.js / npm present and within the required minimum
- Dependencies: lockfile + declared packages installed (reproducible)
- Tools available (browser, runner, HTTP client)
- Playwright available and configured for Web/PWA (`playwright-qa`)
- API adapter available for API Testing (`api-testing`)
- Target accessible: application URL / endpoint reachable (TCP/HTTP status)
- Credentials and configuration available when required (detected by name; the value is never read or printed)
- Test Data available (via `test-data` records; `AVAILABLE` + validated + usable + evidence; UNVERIFIED is not available)
- Evidence: the evidence directory is writable
- QA Reviewer available when required (HIGH/CRITICAL risk) via the **declarative operator signal** `QAA_QA_REVIEWER_AVAILABLE` (recorded as `availability_source: declarative_signal`; the detector performs no automatic reviewer probe)

## Result

```text
READY
```

or

```text
BLOCKED + cause(s)
```

Each check records what was inspected, the observed result, its `capability_state`
(`AVAILABLE`/`REQUIRES_CONFIGURATION`/`NOT_INSTALLED`/`NOT_REQUIRED`/`UNVERIFIED`)
and, when blocked, the action needed to resolve it.

## Rules

- A BLOCKED pre-flight must prevent the execution from starting; state each cause with its concrete action
- A capability not required by the task is recorded as `NOT_REQUIRED` and never blocks
- Never assume a capability is available because it is mentioned in a configuration file; only a real check counts. The QA Reviewer availability is a **declarative operator signal** (`QAA_QA_REVIEWER_AVAILABLE`), never an automatic probe: when the review is mandatory and there is no sufficient evidence of availability, keep an honest `BLOCKED`/`UNVERIFIED` instead of assuming it works
- Pre-flight does not execute Test Cases; reachability probes run through the execution adapter with evidence (Tool Traceability applies)
- Never invent credentials, endpoints or configuration values; missing information → request it (credentials are detected by name only)
- Record the outcome as Pre-flight Record (AGENT-CONTRACTS.md) and validate it with the `contract-validation` skill
- Confidence HIGH/MEDIUM/LOW; an unverifiable check is reported, not assumed OK
- Pre-flight is read-only: it does not modify Test Data or the application
