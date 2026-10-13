---
name: playwright-qa
description: Executes and validates Web/PWA tests with Playwright and captures verifiable evidence; adapter remains decoupled from QA Core.
compatibility: opencode
---

# Playwright QA

## Purpose

Adapter for Web/PWA execution. Must remain decoupled from QA Core logic. Evidence-first.

## Evidence to Capture (when relevant)

- Screenshot
- Trace
- Video
- Console
- Network
- DOM/state info

## Rules

- Never declare PASS because navigation/click completed without error
- Explicitly verify expected state
- Differentiate: tool called/requested → tool executed → execution_success → result obtained → result validated (do not infer success from attempt alone)
- NO EVIDENCE = NO CONFIRMED RESULT
- Never assert execution/validation without evidence
- Save to qa/evidence/ with traceable references
- PWA checks (when applicable): manifest, service worker, cache, offline/online, storage, installability, updates, responsive, sync (only if verifiable)

## Constraints

Playwright specifics stay in this adapter; QA Core rules must not depend on Playwright.

## Reusable runner (M-03)

From `automation/` the repo ships a deterministic runner that executes persisted
Test Cases with Playwright Test **without AI per step**:

- Suites registered in `automation/manifests/<suite_id>.json` (`test_case_id`
  ↔ spec/`test_name`); specs use `automation/runner/support.ts`
  (`targetUrl()`, `recordAssertion()`, `attachAssertions()`).
- Build with `npm run build:runner`; run a suite with
  `node automation/.dist/runner/runner.js --suite <suite_id> [--tc <id>]
  [--autoheal-store <path>] [--out <dir>]` (package shorthand `npm run suite`).
- The runner invokes M-04 pre-flight before executing.
- Exit codes: `0` all PASS · `1` any FAIL/SKIPPED · `2` usage/fatal · `3`
  pre-flight BLOCKED.

## Auto-healing with guardrails (M-05)

The Playwright adapter bundles a controlled selector-recovery engine
(`automation/runner/healed.ts`) with three modes declared in the suite manifest
(`requirements.need.auto_healing.mode`): `OFF` (default), `OBSERVE` and
`HIGH_CONFIDENCE`. When it recovers a broken locator it only substitutes the
locator: it **never** changes Expected Results, **never** converts FAIL into PASS
and **never** classifies a Bug. Every attempt is recorded as an
`auto-heal-record` (M-01) with a unique `heal_id` and screenshot evidence; the
runner adds an `auto_healing` block to each trace and to `summary.json`.

- Candidates are evaluated in a fixed priority order (stable test attributes →
  roles+names → labels/placeholders → visible text/semantic attributes → DOM
  context → other stable attributes) and accepted only if unique, visible,
  state-valid and functionally identical to the declared expectation. Ambiguity,
  a different function or missing identity evidence means no recovery.
- `OFF` never touches the store; `OBSERVE` identifies candidates but never uses
  them; `HIGH_CONFIDENCE` may reuse a store-verified alternative (`ai_calls: 0`).
- A recovery is re-verified after acting; only `POST_VERIFICATION_PASS` results
  are persisted to the reuse store.
- `test-executor`/`qa-reviewer` must treat a trace with `used_recovery: true` as
  a substituted-locator result: the record and trace make it visible, never
  silent. Canonical source: `docs/AUTO-HEALING.md`.
