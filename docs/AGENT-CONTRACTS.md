# Agent Contracts

> These contracts are machine-validated. JSON Schemas live in `qa/schema/`, the validator in `qa/tools/validate_contracts.py`. Full guide: `docs/CONTRACTS-VALIDATION.md`. Validation is a gate, not a decision: it never transforms a result, confirms a Bug, or upgrades a verdict.

## Generic Result

```json
{
  "agent": "qa-lead|test-designer|exploratory-qa|risk-analyst|test-executor|test-data|bug-analyst|qa-reviewer",
  "task": "short description",
  "status": "success|partial|failed|blocked",
  "findings": [],
  "evidence": [{"path": "qa/evidence/...", "type": "screenshot|trace|log|console|network|text|other", "notes": ""}],
  "evidence_links": [{"finding_id": "F-001", "path": "qa/evidence/...", "type": "screenshot|trace|log|console|network|text|other", "notes": ""}],
  "risks": [],
  "confidence": "HIGH|MEDIUM|LOW",
  "confidence_rationale": "brief justification for confidence level",
  "conclusion": "explicit conclusion based on evidence",
  "uncertainties": [],
  "expected_result": "expected behavior/state when applicable",
  "actual_result": "actual behavior/state when applicable",
  "recommendation": "",
  "next_action": ""
}
```

## Test Case

```json
{
  "test_case_id": "TC-001",
  "title": "short descriptive title",
  "objective": "purpose of this Test Case",
  "preconditions": [],
  "test_data": [],
  "steps": [],
  "expected_result": "expected behavior/state",
  "actual_result": "actual behavior/state when executed",
  "status": "PASS|FAIL|BLOCKED|SKIPPED|NOT_EXECUTED",
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "priority": "P0|P1|P2|P3",
  "evidence": [],
  "confidence": "HIGH|MEDIUM|LOW",
  "confidence_rationale": "justification for confidence",
  "risk": "associated risk if applicable",
  "traceability": {"requirement": "", "risk_id": "", "test_data_id": ""},
  "notes": "traceability info"
}
```

## Test Result

```json
{
  "test_id": "TC-001",
  "status": "PASS|FAIL|BLOCKED|SKIPPED",
  "expected_result": "expected behavior/state",
  "actual_result": "actual behavior/state",
  "expected": "expected behavior/state",
  "observed": "actual behavior/state",
  "evidence": [],
  "failure_classification": "APP_BUG|TEST_DATA|TEST_INFRASTRUCTURE|BLOCKED|INSUFFICIENT_EVIDENCE (required when status is FAIL; see Failure Classification)",
  "confidence": "HIGH|MEDIUM|LOW",
  "notes": "traceability info"
}
```

## Bug Record

```json
{
  "bug_id": "BUG-001",
  "title": "",
  "related_test_case_id": "TC-001",
  "failure_classification": "APP_BUG",
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "priority": "P0|P1|P2|P3",
  "status": "CONFIRMED|LIKELY|POSSIBLE|NOT_A_BUG|INSUFFICIENT_EVIDENCE",
  "environment": {},
  "preconditions": [],
  "steps_to_reproduce": [],
  "expected": "",
  "observed": "",
  "evidence": [],
  "possible_cause": "hypothesis only; avoid asserting root cause without evidence",
  "confidence": "HIGH|MEDIUM|LOW"
}
```

## Failure Classification

Formal classification applied to every FAIL **before** confirming a Bug. FAIL does not equal APP_BUG automatically.

Categories:

- `APP_BUG` - sufficient evidence of a problem belonging to the application under test.
- `TEST_DATA` - the result is conditioned by invalid, nonexistent, expired, consumed or inadequate data.
- `TEST_INFRASTRUCTURE` - the problem belongs to the automation, runner, tool or infrastructure used to run the test.
- `BLOCKED` - a necessary condition to execute or verify the Test Case properly does not exist.
- `INSUFFICIENT_EVIDENCE` - a result or indication exists, but the available evidence does not determine the cause with sufficient confidence.

```json
{
  "classification_id": "FC-001",
  "test_id": "TC-001",
  "result_status": "FAIL",
  "failure_classification": "APP_BUG|TEST_DATA|TEST_INFRASTRUCTURE|BLOCKED|INSUFFICIENT_EVIDENCE",
  "analysis_inputs": {
    "expected_result": "",
    "actual_result": "",
    "evidence": [],
    "execution_traceability": "reference to Execution Trace",
    "test_data": [],
    "context": "",
    "memory_considered": []
  },
  "outcome": "TEST_FAILED|CAUSE_IDENTIFIED|BUG_CONFIRMED|BLOCKED|INSUFFICIENT_EVIDENCE",
  "related_bug_id": "",
  "rationale": "why this category and not another",
  "confidence": "HIGH|MEDIUM|LOW",
  "confidence_rationale": "justification for confidence"
}
```

## Test Data Record

```json
{
  "data_id": "TD-001",
  "description": "data required by the Test Cases",
  "test_case_ids": ["TC-001"],
  "required_for": "precondition|step|input",
  "source": "user_provided|application_generated|qa_prepared|unknown",
  "state": "AVAILABLE|MISSING|INVALID|EXPIRED|CONSUMED|UNVERIFIED|NOT_APPLICABLE",
  "validation": {"method": "", "evidence": [], "validated": false},
  "usable": true,
  "blocks_test_cases": [],
  "confidence": "HIGH|MEDIUM|LOW",
  "notes": "traceability Test Case <-> Test Data; never invent values"
}
```

## Pre-flight Record

```json
{
  "preflight_id": "PF-001",
  "scope": "target/suite to be executed",
  "checks": [
    {"check": "target_accessible|credentials_available|tools_available|adapter_available|test_data_available|config_dependencies", "status": "OK|BLOCKED|NOT_APPLICABLE|UNVERIFIED|WARN", "evidence": [], "notes": ""}
  ],
  "result": "READY|BLOCKED",
  "blocked_reasons": [],
  "confidence": "HIGH|MEDIUM|LOW",
  "notes": "BLOCKED pre-flight must prevent the execution from starting"
}
```

The executable detector (M-04, `qa/tools/preflight.py`) keeps `check` as the
canonical category and adds granular fields (`capability`, `capability_state`,
`observed_state`, `required`, `observed`, `action`, `detail`,
`availability_source`). These additive fields are declared and validated in
`pre-flight-record.schema.json` (types and the shared `capabilityState` enum in
`_common.schema.json`); they stay optional, so records created before the
validation remain valid. `availability_source` marks declarative operator
signals (e.g. the QA Reviewer, never automatically probed) as
`declarative_signal` versus `direct_probe`; see
`docs/PRE-FLIGHT-CAPABILITIES.md`.

`status: WARN` is used by the `target_accessible` check when
`need.target.browser_fallback: true` is declared and the HTTP probe was denied
(HTTP 401/403/407/429: `PROBE_DENIED`) or inconclusive (connection error:
`PROBE_INCONCLUSIVE`). A WARN check never blocks (`result` stays `READY`) and
never confirms functional accessibility: the evidence of the real browser
navigation determines it, and the warning is traceable in the pre-flight record
and never mistaken for a Test Case PASS.

## Retest Record

```json
{
  "retest_id": "RT-001",
  "related_bug_id": "BUG-001",
  "related_test_case_id": "TC-001",
  "original_result": "FAIL",
  "retest_result": "PASS|FAIL|BLOCKED|NOT VERIFIED",
  "fix_status": "FIXED|NOT_FIXED|INDETERMINATE",
  "evidence": [],
  "impact_assessment": "risk, affected area, dependencies, related Test Cases",
  "regression_recommended": true,
  "confidence": "HIGH|MEDIUM|LOW",
  "notes": "QA Lead coordinates; Test Executor re-executes; see retest and regression skills"
}
```

## Reviewer Verdict Contract (QA Reviewer)

```json
{
  "verdict": "ACCEPT|CHALLENGE|INSUFFICIENT_EVIDENCE",
  "confidence": "HIGH|MEDIUM|LOW",
  "confidence_rationale": "justification for confidence",
  "findings": [],
  "missing_evidence": [{"path": "qa/evidence/...", "reason": "missing or insufficient"}],
  "evidence_references": [{"path": "qa/evidence/...", "type": "screenshot|trace|log|console|network|text|other", "notes": ""}],
  "reasoning_summary": "concise rationale supporting the verdict",
  "requires_retest": false,
  "requires_additional_evidence": false,
  "recommendations": []
}
```

## Lead Consolidation Report

```json
{
  "objective": "",
  "context": "",
  "risk_summary": "",
  "inputs_by_agent": [{"agent": "test-designer|exploratory-qa|risk-analyst|test-executor|test-data|bug-analyst|qa-reviewer", "output_ref": "path or identifier", "status": "received|not_received"}],
  "conflicts": [],
  "confirmed_findings": [],
  "uncertain_findings": [],
  "not_verified": [],
  "blocked": [],
  "final_conclusion": "",
  "reviewer_verdict": {},
  "confidence": "HIGH|MEDIUM|LOW",
  "evidence_index": [{"evidence_ref": "qa/evidence/...", "linked_to": "finding/test/case", "notes": ""}],
  "uncertainties": []
}
```

## Risk Record

```json
{
  "risk_id": "R-001",
  "risk": "description of risk",
  "category": "functional|technical|integration|regression|other",
  "impact": "CRITICAL|HIGH|MEDIUM|LOW",
  "probability": "HIGH|MEDIUM|LOW",
  "risk_level": "CRITICAL|HIGH|MEDIUM|LOW",
  "priority": "P0|P1|P2|P3",
  "rationale": "justification",
  "action_required": "none|test|mitigate|block|retest|review",
  "required_evidence": [],
  "needs_double_check": true,
  "needs_qa_reviewer": true,
  "confidence": "HIGH|MEDIUM|LOW",
  "mitigations": []
}
```

## Exploratory Finding

```json
{
  "finding_id": "EF-001",
  "scope": "",
  "observation": "factual observation",
  "hypothesis": "testable hypothesis when applicable",
  "evidence": [],
  "expected_result": "expected when comparing",
  "actual_result": "observed when comparing",
  "conclusion": "conclusion with evidence support",
  "status": "OBSERVATION|HYPOTHESIS|CONFIRMED|INCONCLUSIVE|NOT_A_BUG|INSUFFICIENT_EVIDENCE|BLOCKED",
  "confidence": "HIGH|MEDIUM|LOW",
  "uncertainties": [],
  "risk": "associated risk if applicable"
}
```

## Memory Record Contract

```json
{
  "memory_id": "MEM-001",
  "related_bug_id": "",
  "related_test_case_id": "",
  "area": "",
  "cause": "confirmed cause only when evidence supports it; otherwise empty",
  "failure_classification": "APP_BUG|TEST_DATA|TEST_INFRASTRUCTURE|BLOCKED|INSUFFICIENT_EVIDENCE|",
  "test_data_refs": [],
  "retest_refs": [],
  "regression_refs": [],
  "symptoms": [],
  "hypothesis": "",
  "evidence_refs": [],
  "confidence": "HIGH|MEDIUM|LOW",
  "frequency": 0,
  "last_seen": "",
  "status": "HISTORICAL|RELEVANT|STALE|ARCHIVED",
  "regression_risk": "CRITICAL|HIGH|MEDIUM|LOW",
  "tags": []
}
```

## Execution Trace / Test Execution Traceability

```json
{
  "trace_id": "TR-001",
  "context": "test execution context",
  "tool_requested": "tool/action requested",
  "tool_executed": "actual tool/action executed",
  "executed": true,
  "execution_success": true,
  "result_obtained": "result obtained from execution",
  "result_validated": "result after validation against expected",
  "expected_result": "expected",
  "actual_result": "actual",
  "evidence": [],
  "validation_performed": true,
  "notes": "traceability of tool called -> tool succeeded -> result obtained -> result validated"
}
```

## Execution Report (M-02)

Complete execution report for a runner suite run. Generated as `report.json` (structured data) and `report.html` (human-readable view) in the run output directory. Both formats represent the same execution; the HTML is always derived from the JSON. Canonical source: `automation/runner/report.ts`.

```json
{
  "report_id": "ER-<run_id>",
  "run_id": "R-20261010T120000000",
  "suite_id": "SUITE-demo-qaa-web",
  "app": "demo-qaa",
  "platform": "web",
  "started_at": "2026-10-10T12:00:00.000Z",
  "ended_at": "2026-10-10T12:00:05.000Z",
  "duration_ms": 5000,
  "overall_status": "PASS | FAIL | BLOCKED | SKIPPED | PARTIAL",
  "summary": {
    "selected": 2,
    "executed": 2,
    "passed": 2,
    "failed": 0,
    "blocked": 0,
    "skipped": 0,
    "omitted": 0
  },
  "cases": [
    {
      "test_case_id": "TC-DEMO-WEB-1",
      "title": "Home page loads",
      "status": "PASS | FAIL | BLOCKED | SKIPPED",
      "duration_ms": 2500,
      "spec": "automation/specs/demo-web/site.spec.ts",
      "error": "error message when FAIL",
      "block_reason": "block reason when BLOCKED",
      "evidence": ["automation/.runs/suite/R-xxx/evidence/TC-DEMO-WEB-1_assertions.json"],
      "auto_healing": {}
    }
  ],
  "preflight": {
    "result": "READY | BLOCKED | SKIPPED",
    "blocked_reasons": [],
    "record_path": "automation/.runs/suite/R-xxx/preflight_record.json"
  },
  "auto_healing": {
    "mode": "OFF | OBSERVE | HIGH_CONFIDENCE",
    "attempts": 3,
    "recoveries_used": 2,
    "reused": 1,
    "duplicate_prevented": 0,
    "ai_calls": 0
  },
  "infrastructure_errors": [],
  "evidence_index": [
    {
      "path": "automation/.runs/suite/R-xxx/evidence/TC-DEMO-WEB-1_assertions.json",
      "type": "screenshot",
      "test_case_id": "TC-DEMO-WEB-1"
    }
  ],
  "generated_at": "2026-10-10T12:00:05.000Z"
}
```

- `overall_status`: `PASS` (all passed), `FAIL` (at least one FAIL), `BLOCKED` (pre-flight BLOCKED), `PARTIAL` (mix of PASS and SKIPPED), `SKIPPED` (all skipped).
- `summary.omitted`: Test Cases in the manifest but not selected for execution.
- `cases[].auto_healing`: present when M-05 enrichment is available for that Test Case.
- `auto_healing`: present only when mode is not OFF or attempts > 0.
- The HTML report is generated from the JSON report with proper HTML escaping (XSS-safe).
- No credentials, tokens, or environment variable values are included in either format.

## Data Verification (M-06)

Result of a QA data verification against a read-only database. The adapter executes a read-only SQL query and contrasts the obtained data with an expected condition. Canonical source: `automation/runner/sqlite-adapter.ts`.

```json
{
  "verification_id": "DV-001",
  "description": "Check product count in database",
  "status": "PASS | FAIL | ERROR",
  "query": "SELECT COUNT(*) as cnt FROM products",
  "params": [],
  "rows_returned": 1,
  "duration_ms": 15,
  "expected": {
    "type": "row_count | column_value | not_empty | empty",
    "count": 1,
    "column": "status",
    "value": "<redacted>",
    "operator": "="
  },
  "actual": {
    "row_count": 1,
    "column_value": "<redacted>",
    "column_found": true
  },
  "error": "error message when status is ERROR",
  "evidence": ["query: SELECT COUNT(*) as cnt FROM products", "rows_returned: 1", "duration_ms: 15"]
}
```

- `status`: `PASS` (condition met), `FAIL` (condition not met), `ERROR` (execution error).
- `expected.type`: `row_count` (compare row count), `column_value` (compare a column value), `not_empty` (expect rows), `empty` (expect no rows).
- `expected.operator`: `=`, `!=`, `>`, `<`, `>=`, `<=` (for `column_value`).
- For `column_value`, `expected.value` and `actual.column_value` are **always** persisted as the `<redacted>` placeholder: the real values are used only to evaluate the comparison and never appear in a result, message or evidence. `status`, `column`, `operator`, `column_found` and the evidence references are preserved.
- The adapter opens the database in READ-ONLY mode at the engine level and rejects write operations.
- Only SQLite is supported initially; the interface allows other engines without changing QA core logic.

## Auto-Heal Record

Structured record of ONE M-05 selector-recovery attempt. It NEVER changes Expected Results, NEVER converts FAIL into PASS and NEVER classifies a Bug: the status stays as produced by the assertions. Canonical source: `docs/AUTO-HEALING.md`.

```json
{
  "heal_id": "AH-<run_id>-<context_id>-<seq>",
  "run_id": "R-001",
  "suite_id": "SUITE-heal-demo-hc",
  "app": "demo-heal",
  "test_case_id": "TC-HEAL-2",
  "spec": "automation/specs/heal-demo/hc.spec.ts",
  "test_title": "TC-HEAL-2: recupera con el atributo de prueba estable y verifica la recuperación",
  "selector_original": "#search-box",
  "candidates": [
    {
      "selector": "[data-testid=\"search-field\"]",
      "strategy": "stable_attribute",
      "count": 1,
      "unique": true,
      "visible": true,
      "enabled": true,
      "editable": true,
      "role": "textbox",
      "identity": true,
      "reason": "unique match (count=1), state ok, identity verified (role=textbox)",
      "accepted": true
    }
  ],
  "selector_used": "[data-testid=\"search-field\"]",
  "strategy_used": "stable_attribute",
  "reason_accept": "selector recovered and post-verified",
  "reason_reject": null,
  "mode": "HIGH_CONFIDENCE",
  "used_recovery": true,
  "reused_from_store": false,
  "verification_after": "POST_VERIFICATION_PASS",
  "status": "RECOVERED",
  "action": "fill",
  "expected": {},
  "url": "http://127.0.0.1:4174/heal/demo?v=1&cart=0",
  "evidence": [],
  "confidence": "HIGH",
  "duplicate_prevented": false,
  "ai_calls": 0,
  "duration_ms": 1234,
  "timestamp": "2026-10-10T18:34:10.018Z"
}
```

- `mode`: `OFF` (default) | `OBSERVE` | `HIGH_CONFIDENCE`.
- `status`: `ORIGINAL_OK|RECOVERED|REUSED|OBSERVED|REJECTED|AMBIGUOUS|STALE|NO_CANDIDATE|NOT_ATTEMPTED` (the engine keeps the real status and marks mutation protection with `duplicate_prevented: true`; `DUPLICATE_PREVENTED` remains a reserved enum value not emitted by the current engine).
- `strategy_used` / candidate `strategy`: `stable_attribute|role_name|label_placeholder|visible_text|dom_context|other_attribute|stored_reuse`.
- `verification_after`: `POST_VERIFICATION_PASS|POST_VERIFICATION_FAIL|NOT_PERFORMED`.
- `used_recovery: true` requires `selector_used`, `strategy_used` and `reason_accept` (machine-validated).
- `ai_calls` is always `0`: recovery and store reuse never call an AI model.
- A candidate is accepted only if unique (count=1), visible, state-valid and functionally identical to the declared expectation; ambiguity, a different function or missing identity evidence means no recovery.

## Memory Rules (Reading/Writing)

- **Historical data is not current evidence.** Information from `qa/memory/` must never be treated as confirmed current state solely because it exists.
- **Validate against current evidence.** Any use of memory for regression/decisions requires validation against current behavior and current evidence.
- **Writing:** Only record verifiable historical findings with clear state, uncertainties, and evidence references. Avoid writing unconfirmed hypotheses as facts.
- **No facts from hypotheses:** `cause`, `failure_classification` and fix status are recorded only when supported by current evidence; hypotheses stay in `hypothesis` and are never written as confirmed facts.
- **Retest/Regression:** record retest and regression outcomes only when they were executed, with their evidence references; a planned or recommended retest is not a result.
- **Reading:** Explicitly state which memory entries were considered, why relevant, and what current evidence confirms/refutes them.
- **Reference:** Store under `qa/memory/` with traceable references to `qa/bugs/`, `qa/reports/`, `qa/evidence/`, and/or test cases.

## Traceability Requirements

- Every conclusion must link to evidence (use `evidence_links` when mapping findings).
- expected vs observed/expected_result vs actual_result must be explicit when applicable.
- confidence must be stated with `confidence_rationale` when required.
- Use INSUFFICIENT_EVIDENCE/BLOCKED/NOT_VERIFIED when uncertain.
- Tool traceability: tool called/requested -> tool executed -> execution_success -> result_obtained -> result_validated. Failure to execute means not executed; do not infer success.
- Failure Classification: every FAIL must carry a Failure Classification (APP_BUG/TEST_DATA/TEST_INFRASTRUCTURE/BLOCKED/INSUFFICIENT_EVIDENCE) before confirming a Bug; FAIL is not APP_BUG by default.
- Test Data: Test Cases must trace to Test Data Records (`test_data_id`); missing or unusable data blocks the affected Test Cases and must never be invented.
- Pre-flight: a relevant execution requires a READY Pre-flight; otherwise the execution is BLOCKED with its causes.
- Retest/Regression: retest results require current evidence; regression must be justified by risk, impact, affected area, dependencies and related Test Cases.

## Machine Validation

Contracts are backed by JSON Schemas (Draft 2020-12) in `qa/schema/` and an executable validator in `qa/tools/validate_contracts.py` (Python 3 standard library, no third-party dependencies). Full guide: `docs/CONTRACTS-VALIDATION.md`.

- Run: `python qa/tools/validate_contracts.py --list | --contract <name> --file <artifact> | --bundle qa/ [--json] [--check-evidence]`
- Registry: `qa/schema/index.json` maps each contract to its schema, artifact shape, detection hints and reference rules.
- Validated: types, required fields, ID patterns, exact enums (states, Failure Classification categories, confidence, reviewer verdicts) and QA business rules encoded with `if`/`then`: FAIL requires a classification; `CONFIRMED` Bug ⇒ `APP_BUG` + evidence; reviewer `ACCEPT` ⇒ evidence and no missing evidence; HIGH/CRITICAL risk ⇒ QA Reviewer; BLOCKED/READY pre-flight; AVAILABLE/UNVERIFIED Test Data; FIXED retest; Execution Trace non-inference.
- Referential integrity (bundle mode): Test Data ↔ Test Case, Bug ↔ Test Case, Failure Classification ↔ Test Case/Bug, Retest ↔ Bug/Test Case, Memory ↔ Bug/Test Case, Test Case traceability ↔ Risk.
- Guarantee: validation is read-only and never transforms. It does not turn FAIL into PASS, does not confirm Bugs, does not upgrade verdicts, and preserves BLOCKED / NOT VERIFIED / INSUFFICIENT_EVIDENCE.
- Gate: artifacts that fail validation block consolidation; a report is not final while its artifacts are invalid.
- Compatibility notes and migration proposals for the existing artifacts are documented in `docs/CONTRACTS-VALIDATION.md`.
