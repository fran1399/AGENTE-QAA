# Contracts Validation (M-01)

Machine-verifiable contracts for the QA artifacts. This document explains what is
validated, how to run the validator, how to read its output, how it is integrated
into the QA flow, and how to add new contracts.

- Canonical contract definitions: `docs/AGENT-CONTRACTS.md`
- Schemas: `qa/schema/*.schema.json` (JSON Schema Draft 2020-12)
- Registry: `qa/schema/index.json`
- Validator: `qa/tools/validate_contracts.py`
- Tests: `qa/tools/test_validate_contracts.py`
- Fixtures: `qa/tools/fixtures/`

## Why

Before M-01 the contracts existed only as prose and examples. An artifact could
violate its contract (missing evidence, invalid enum, a FAIL without
classification, a `CONFIRMED` Bug without justification) with nothing detecting
it. M-01 turns the contracts into JSON Schemas and adds an executable validator
plus automated tests.

The validator is a **gatekeeper, not a decision maker**:

- It never transforms an invalid result into a valid one.
- It never turns a FAIL into a PASS.
- It never confirms a Bug, accepts a verdict, or upgrades a state.
- It only reports `contrato`, `resultado`, `campo`, `ubicación`, `motivo` and the
  `artefacto` affected.

## Contracts covered

| Contract | Schema | Artifact shape |
| --- | --- | --- |
| Generic Result | `generic-result.schema.json` | single object |
| Test Case | `test-case.schema.json` | wrapper `{..., "test_cases": [...]}` |
| Test Result | `test-result.schema.json` | object or array |
| Bug Record | `bug-record.schema.json` | object or array |
| Failure Classification | `failure-classification.schema.json` | object or array |
| Test Data Record | `test-data-record.schema.json` | object or array |
| Pre-flight Record | `pre-flight-record.schema.json` | object or array |
| Retest Record | `retest-record.schema.json` | object or array |
| Reviewer Verdict | `reviewer-verdict.schema.json` | single object |
| Lead Consolidation Report | `lead-consolidation-report.schema.json` | single object |
| Risk Record | `risk-record.schema.json` | object or array |
| Exploratory Finding | `exploratory-finding.schema.json` | object or array |
| Memory Record | `memory-record.schema.json` | object or array |
| Execution Trace | `execution-trace.schema.json` | wrapper `{..., "traces": [...]}` |
| QA Report Model | `qa-report-model.schema.json` | single object (`report_model_id` hint) |

Shared definitions (`confidence`, severity/priority, evidence items, Failure
Classification categories, traceability) live in `_common.schema.json`.

## How to run

Requires only Python 3 (standard library). No third-party packages, no Node.

```bash
# List the registered contracts
python qa/tools/validate_contracts.py --list

# Validate one artifact against a known contract
python qa/tools/validate_contracts.py --contract test-case --file qa/tools/fixtures/valid/test_case_suite.json

# Validate everything found under qa/ and check cross-artifact references
python qa/tools/validate_contracts.py --bundle qa/

# Machine-readable output (for automation/reports)
python qa/tools/validate_contracts.py --bundle qa/ --json

# Also warn when a referenced evidence path does not exist
python qa/tools/validate_contracts.py --bundle qa/ --check-evidence

# Run the automated tests
python qa/tools/test_validate_contracts.py
```

Exit codes:

- `0` all artifacts valid (warnings allowed)
- `1` at least one validation error
- `2` fatal usage/configuration error

`--bundle DIR` discovers JSON artifacts under `DIR` (skipping `schema/`, `tools/`,
`fixtures/` and `*.schema.json`), validates each against its contract, and then
checks referential integrity. Cross-artifact reference checks only run in bundle
mode, because they need the whole artifact set.

### Reading the output

Human output:

```text
[INVALID] bug-record   qa/bugs/example.json  (1 records)
    error    minItems   /evidence  (evidence)
             array has 0 items, expected at least 1
```

Each error reports the contract, the artifact, the failing keyword, the JSON
Pointer location, a human location and the concrete reason. `--json` returns the
same information as structured data.

## What the schemas enforce

Types and required fields, value ranges, ID patterns, and the exact enums for
states, Failure Classification categories, confidence levels and reviewer
verdicts. On top of that, the QA business rules are encoded directly in the
schemas with `if`/`then`, so the engine stays generic:

- Missing required fields and wrong types fail.
- Invalid enums fail (e.g. `confidence`, `failure_classification`, `status`,
  `verdict`).
- `PASS`/`FAIL` Test Cases require evidence and an actual result.
- A FAIL Test Result requires a `failure_classification` and evidence.
- A `CONFIRMED` Bug must be `APP_BUG` with evidence; `INSUFFICIENT_EVIDENCE`
  cannot be `APP_BUG`.
- A reviewer `ACCEPT` requires evidence references, no `missing_evidence`, and no
  pending additional evidence.
- `BLOCKED` pre-flight requires causes; `READY` cannot carry them.
- `AVAILABLE` Test Data requires validated evidence and `usable: true`;
  `UNVERIFIED` is never `AVAILABLE`.
- `FIXED` retest requires `retest_result: PASS` with evidence.
- HIGH/CRITICAL risk requires the QA Reviewer.
- Execution Trace cannot report `execution_success: true` when `executed: false`,
  and a performed validation requires a `result_validated` description.

Referential integrity (bundle mode) checks that referenced ids resolve:
`failure-classification.test_id`, `test-data-record.test_case_ids[]`,
`bug-record.related_test_case_id`, `retest-record.related_bug_id`,
`retest-record.related_test_case_id`, `failure-classification.related_bug_id`,
`memory-record.related_bug_id`, `memory-record.related_test_case_id`,
`test-case.traceability.risk_id`.

## Integration in the QA flow

The validator is invoked at the two points where results are produced and
consolidated:

1. **Result / evidence generation** — Test Executor validates the produced Test
   Results, Failure traces and Pre-flight/Test Data records before handing them
   off. Bug Analyst validates each Bug Record / Failure Classification before a
   Bug is confirmed.
2. **Consolidation** — before the final report, QA Lead validates the whole
   artifact set (`--bundle qa/`). Invalid artifacts **block** consolidation: a
   report is not final while its artifacts fail validation.

The `contract-validation` skill (`skills/contract-validation/SKILL.md`) describes
the reusable procedure. Validation is **not** a substitute for the QA Reviewer:
it checks structural and rule conformance, not the truthfulness of the evidence.

## How to add a new contract

1. Add the schema `qa/schema/<name>.schema.json`. Reuse shared definitions from
   `_common.schema.json` via `$ref`. Keep `additionalProperties: true` for
   compatibility unless strictness is explicitly desired.
2. Register it in `qa/schema/index.json` under `contracts` with:
   - `schema`: the schema file name;
   - `shape`: `record`, `record-or-array`, or `wrapper`
     (`wrapper` also needs `records_key` and `wrapper_required`);
   - `id_key`: the field used as the record id.
3. If artifacts of this contract must be auto-detected, add its signature key to
   `artifact_hints` (or `wrapper_hints`). Put distinctive keys before generic
   ones: for example `classification_id` before `test_id`, because a Failure
   Classification also carries `test_id`.
4. If other artifacts reference it, add a rule under `references`:
   `{ "id": "...", "from": "<contract>", "path": "<field or field[] or a.b>", "to": "<contract>" }`.
5. Add valid and invalid fixtures under `qa/tools/fixtures/` and extend
   `qa/tools/test_validate_contracts.py`.

The JSON Schema subset supported by the validator is: `type`, `enum`, `const`,
`required`, `properties`, `additionalProperties`, `items`, `minItems`,
`maxItems`, `uniqueItems`, `minLength`, `maxLength`, `pattern`, `minimum`,
`maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minProperties`,
`maxProperties`, `allOf`, `anyOf`, `oneOf`, `not`, `if`/`then`/`else`, and
`$ref` (local and cross-file to `_common.schema.json`).

### Supported vocabulary and schema self-check (D1)

Annotation keywords are accepted and ignored (they carry no validation
semantics): `$schema`, `$id`, `$anchor`, `$vocabulary`, `$comment`, `title`,
`description`, `default`, `deprecated`, `readOnly`, `writeOnly`, `examples`.
The container `$defs` holds sub-schemas.

Before validating any artifact, the validator **self-checks every schema**:

- A *standard* JSON Schema keyword the engine does not implement
  (`patternProperties`, `propertyNames`, `contains`, `prefixItems`,
  `dependentSchemas`, `dependentRequired`, `unevaluatedProperties`,
  `unevaluatedItems`, `multipleOf`, `format`, `content*`, `$anchor`,
  `$dynamicRef`, `$dynamicAnchor`, …) is **rejected**: the schema would
  silently skip a rule (or change `$ref` resolution), so validation aborts.
- An invalid `type` name (for example `objectt`) is rejected. Allowed types are
  `null`, `boolean`, `object`, `array`, `number`, `string`, `integer`, alone or
  combined in an array.
- Any other unknown key is rejected unless it is a **custom extension**
  namespaced with the `x-` prefix (for example `x-internal`). Custom extensions
  are intentionally ignored by the engine; they are never confused with a
  standard rule that was skipped.

When the self-check fails, the validator aborts with exit code `2` and prints
each issue as `schema location [keyword] reason`, so no artifact can be
reported `VALID` under a rule that was not evaluated.

## Compatibility notes and migration proposals

These were found while mapping the existing artifacts in `qa/` to the contracts.
No existing artifact was modified; the schemas accept the current shapes.

1. **Test Case is stored as a suite wrapper.** `qa/tools/fixtures/valid/test_case.suite.json` is
   `{suite_id, ..., test_cases: [...]}`, while the contract shows a single Test
   Case. The validator extracts records from the wrapper. *No migration needed.*
2. **Bug Record field aliases.** Artifacts use `expected_result`/`observed`; the
   contract example uses `expected`/`observed`. The schema accepts both.
   *Proposal (not applied): standardize on `expected`/`observed` in a future
   revision.*
3. **Bug / Risk artifacts are bare arrays.** The contract shows a single object.
   Both shapes are supported.
4. **Evidence items are strings.** Artifacts use plain strings; the Generic
   Result contract uses `{path, type, notes}` objects. The schema accepts a
   string or an object. *Proposal (not applied): prefer structured evidence
   objects going forward.*
5. **State vocabulary.** Test Case status uses `NOT_EXECUTED`, the Retest
   contract uses `NOT VERIFIED` (with a space), and Report Modes use
   `NOT VERIFIED`. Each schema preserves the exact vocabulary of its contract.
   *Proposal (not applied): normalize this vocabulary in a coordinated contract
   revision; until then the enums are intentionally contract-faithful.*
6. **Optional Bug fields.** Existing `NOT_A_BUG` records omit
   `related_test_case_id`/`failure_classification`; these are optional and only
   become required for `CONFIRMED`/`BUG_CONFIRMED`. *Proposal: populate them
   going forward for traceability.*
7. **Open objects.** Record schemas use `additionalProperties: true` so unknown
   fields never break compatibility. A strict mode is out of scope for M-01.
8. **Pre-flight `check` enum is coarse (M-04).** `pre-flight-record.checks[].check`
   is closed to 6 canonical categories and has no dedicated value for "evidence
   writable" or "QA Reviewer", nor a granular check id. The M-04 detector
   (`qa/tools/preflight.py`) does **not** change the enum: it keeps `check` as
   the canonical category and puts the granularity in additive fields
   (`capability`, `capability_state`, `observed_state`, `required`, `observed`,
   `action`, `detail`, `availability_source`). Those additive fields are now
   **declared and validated** in `pre-flight-record.schema.json` (types and
   enums shared in `_common.schema.json#/$defs/capabilityState`), so invalid
   types or states are rejected by M-01, while older records without them remain
   valid (the fields stay optional). `availability_source` records whether a
   capability's availability is a declarative operator signal
   (`declarative_signal`) or a direct environment probe (`direct_probe`); the
   current detector only emits the declarative kind for the QA Reviewer and
   never claims an automatic probe. *Proposal (not applied): add
   `evidence_writable` and `reviewer_available` to the `check` enum in a future
   revision.* See `docs/PRE-FLIGHT-CAPABILITIES.md`.

## Limitations

- The JSON Schema engine is a focused subset, not a full Draft 2020-12
  implementation. Unsupported standard keywords are **not silently ignored**:
  the schema self-check (D1) rejects them at startup (exit `2`). The engine
  still has no support for `patternProperties`, `prefixItems`, `contains`,
  `format` validation, `unevaluatedProperties` and similar keywords; enabling
  any of them requires implementing the engine, not just editing a schema.
- `additionalProperties: true` is used across the record schemas, so unknown
  *fields inside artifacts* are not flagged (a strict mode is out of scope for
  M-01).
- It validates structure and rules, not the truthfulness or sufficiency of
  evidence; that remains the QA Reviewer's responsibility.
- Evidence file existence checking is opt-in (`--check-evidence`) and emits
  warnings, so it never fails a validation on its own.
- Cross-artifact references require bundle mode.
