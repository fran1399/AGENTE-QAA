---
name: contract-validation
description: Runs the executable contract validator as a gate on QA artifacts; reports contract, result, field/location, reason and affected artifact without transforming any result.
compatibility: opencode
---

# Contract Validation

## Purpose

Reusable procedure to verify that QA artifacts conform to their contracts
(`docs/AGENT-CONTRACTS.md`) using the executable validator and the JSON Schemas
in `qa/schema/`. It is a gatekeeper: it reports conformance, it never decides the
QA outcome and never rewrites an artifact.

## When to use

- After generating Test Results, Execution Traces, Pre-flight/Test Data records
  or Failure Classifications.
- Before confirming any Bug.
- Before the final consolidation/report (validate the whole artifact set).

## Procedure

1. Validate the artifact(s) against the registry:

   ```bash
   python qa/tools/validate_contracts.py --list
   python qa/tools/validate_contracts.py --contract <name> --file <artifact>
   python qa/tools/validate_contracts.py --bundle qa/
   python qa/tools/validate_contracts.py --bundle qa/ --json
   ```

2. Read each finding as `contract`, `result`, `keyword`, `field`, `path`
   (location) and `reason`; the artifact path is included.
3. Treat any `error` as blocking for consolidation. Warnings (`reference`
   optional, `--check-evidence`) are reported but do not by themselves invalidate.
4. Exit codes: `0` valid, `1` at least one error, `2` fatal.

## Rules

- The validator never transforms a result: it does not turn FAIL into PASS, does
  not confirm Bugs and does not upgrade verdicts or states.
- `BLOCKED`, `NOT VERIFIED` and `INSUFFICIENT_EVIDENCE` are preserved as states.
- A report is not final while artifacts fail validation; surface invalid
  artifacts and their reasons instead of consolidating over them.
- Validation is structural + rule-based; it does not replace the QA Reviewer.
  Evidence truthfulness and sufficiency remain a human/QA-Reviewer judgement.
- Full reference: `docs/CONTRACTS-VALIDATION.md`.
