# QA Agentic System for OpenCode

Core infrastructure for a multi-agent QA system running in OpenCode. Evidence-first, risk-based, with independent review.

## Quick Start

1. Verify model availability:
```bash
opencode models
```
2. Open this repository in OpenCode.
3. Default primary agent is `qa-lead`.
4. Have `qa-lead` inspect the application/system under test before executing tests.

## Agents

- `qa-lead` – Orchestration and final QA decisions
- `test-designer` – Test design and coverage
- `exploratory-qa` – Risk-guided exploration
- `risk-analyst` – Risk assessment and prioritization
- `test-executor` – Pre-flight and controlled execution with verifiable evidence (testing execution only; adapters: Playwright / API)
- `test-data` – Test Data identification, validation and Test Case traceability
- `bug-analyst` – Failure analysis, Failure Classification and Bugs
- `qa-reviewer` – Independent challenger/reviewer

## Core Principles

- NO EVIDENCE = NO CONFIRMED RESULT
- Separate expected/observed/evidence/conclusion/confidence
- Differentiate: tool called → tool succeeded → result obtained → result validated
- FAIL ≠ APP_BUG: every FAIL is classified (APP_BUG/TEST_DATA/TEST_INFRASTRUCTURE/BLOCKED/INSUFFICIENT_EVIDENCE) before a Bug is confirmed
- QA Reviewer must challenge critical conclusions
- Playwright (Web/PWA) and api-testing (API/HTTP) decoupled from QA Core
- Least privilege; read-only by default

## Structure

- `.opencode/agents/` – Agent definitions
- `.opencode/skills/` – Reusable procedures
- `docs/` – Contracts, roles, architecture, policy
- `qa/` – Runtime data (evidence, bugs, reports, memory, tests)
- `tests/` – Test definitions/cases
- `automation/` – Runner M-03 + Pre-flight (M-04) + auto-healing (M-05) + reportes (M-02): base de automatización (Playwright Test, Web/API, desacoplada del QA Core)

## Automation (M-03 runner)

The repository ships a **reusable runner** (M-03) that executes persisted Test
Cases **without AI per step**, built on Node.js 24.x LTS + Playwright Test
(Web + API). It is **separated from `qa/`** so it does not interfere with the
M-01 contract validator. The Python validator is **not** migrated or
duplicated.

```bash
npm ci                     # reproducible install from package-lock.json
npm run verify:env         # check runtime, deps, browser and lockfile
npm run browsers:install   # install Chromium
npm run build:runner       # compile the runner (automation/.dist)
npm test                   # 59 tests: 2 smoke + 32 runner.infra (10 M-03 + 6 M-05 + 8 M-02 + 8 M-06) + 25 sqlite-adapter (M-06)
npm run suite:demo-web     # demo Web suite without AI (2 TC) → automation/.runs/suite-demo-web
npm run suite:demo-api     # demo API suite without AI (2 TC) → automation/.runs/suite-demo-api
npm run typecheck          # tsc --noEmit
```

The runner loads a suite manifest (`automation/manifests/<suite_id>.json`),
runs the M-04 pre-flight (BLOCKED ⇒ exit 3, no execution), executes the
selected specs with Playwright, maps results to `execution-trace` records
(validated by M-01) and promotes evidence per Test Case. It never classifies a
FAIL (Bug Analyst does). Exit codes: 0 all PASS · 1 any FAIL/SKIPPED · 2
usage/fatal · 3 pre-flight BLOCKED.

## Execution Reports (M-02)

Every run generates two reports in the run output directory:

- **`report.json`** — structured execution data (validated by M-01 against the `execution-report` contract).
- **`report.html`** — human-readable view generated from the JSON (single source of truth).

Both include: run/suite identifiers, timestamps, overall status (PASS/FAIL/BLOCKED/PARTIAL/SKIPPED), per-case results with duration and error/block reasons, evidence references, pre-flight result, auto-healing stats, and infrastructure errors. The HTML escapes all dynamic content (XSS-safe) and contains no credentials or environment secrets.

```bash
npm run suite:demo-web     # generates automation/.runs/suite-demo-web/<run_id>/report.{json,html}
```

Key docs: `docs/RUNNER-M03.md` (M-03), `docs/AUTOMATION-ARCHITECTURE.md`,
`docs/PRE-FLIGHT-CAPABILITIES.md` (M-04) and `docs/AUTO-HEALING.md` (M-05,
implemented: modes OFF/OBSERVE/HIGH_CONFIDENCE). Details in `automation/README.md`.

## Pre-flight (M-04)

A deterministic, read-only capability detector checks the conditions a concrete
execution needs (runtime, dependencies, adapter, browsers, tools, target,
credentials by name, Test Data, evidence storage and QA Reviewer availability)
and emits a `pre-flight-record` validated by M-01. It never executes Test Cases
or reveals credential values.

```bash
python qa/tools/preflight.py --requirements qa/tools/fixtures/preflight/requirements_demo_web.json
# exit 0 = READY, 1 = BLOCKED (with causes), 2 = fatal
```

Tests: `python qa/tools/test_preflight.py`. Format, vocabulary and mapping to the
contract: `docs/PRE-FLIGHT-CAPABILITIES.md`.

## Notes

MCP is disabled by default. No example app, CI/CD, or code generation in this core.
The automation base does not change QA Core decisions, contracts or results.

## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for the full text.

Copyright (c) 2026 Francisco Ruiz
