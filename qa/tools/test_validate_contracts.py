#!/usr/bin/env python3
"""Automated tests for the QA contract validator (M-01).

Run:
    python qa/tools/test_validate_contracts.py
    python -m unittest discover -s qa/tools -p "test_*.py" -v

Covers: valid structures, missing required fields, wrong types, invalid enums,
broken conditional (semantic) rules, referential integrity, state preservation,
and the guarantee that validation never transforms a result.
"""
from __future__ import annotations

import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
FIXTURES = os.path.join(HERE, "fixtures")

if HERE not in sys.path:
    sys.path.insert(0, HERE)

import validate_contracts as vc  # noqa: E402


def fixture(group, name):
    return os.path.join(FIXTURES, group, name)


def repo_relative(rel):
    return os.path.join(REPO_ROOT, rel)


def valid_execution_report():
    """Minimal runner-shaped report.json that satisfies the execution-report contract."""
    return {
        "report_id": "ER-20260101T000000000Z",
        "run_id": "R-20260101T000000000Z",
        "suite_id": "SUITE-unit",
        "app": "demo-qaa",
        "platform": "web",
        "started_at": "2026-01-01T00:00:00.000Z",
        "ended_at": "2026-01-01T00:00:01.000Z",
        "overall_status": "PASS",
        "summary": {
            "selected": 1,
            "executed": 1,
            "passed": 1,
            "failed": 0,
            "errors": 0,
            "blocked": 0,
            "skipped": 0,
            "omitted": 0,
        },
        "cases": [
            {"test_case_id": "TC-1", "title": "unit", "status": "PASS", "duration_ms": 1}
        ],
        "generated_at": "2026-01-01T00:00:01.000Z",
    }


def valid_data_verification():
    """Minimal runner-shaped data-verification record."""
    return {
        "verification_id": "DV-1",
        "description": "unit verification",
        "status": "PASS",
        "query": "SELECT 1",
        "rows_returned": 1,
        "duration_ms": 1,
        "expected": {"type": "not_empty"},
        "actual": {"row_count": 1},
        "evidence": ["automation/.runs/unit/data_verification.json"],
    }


class ValidFixturesTest(unittest.TestCase):
    CASES = [
        ("test-case", "valid/test_case.suite.json"),
        ("test-result", "valid/test_result_fail.json"),
        ("failure-classification", "valid/failure_classification.json"),
        ("bug-record", "valid/bug_record_confirmed.json"),
        ("risk-record", "valid/risk_record.json"),
        ("reviewer-verdict", "valid/reviewer_verdict_accept.json"),
        ("execution-trace", "valid/execution_trace.json"),
        ("test-data-record", "valid/test_data_record_available.json"),
        ("pre-flight-record", "valid/preflight_blocked.json"),
        ("pre-flight-record", "valid/preflight_extended.json"),
        ("retest-record", "valid/retest_fixed.json"),
        ("lead-consolidation-report", "valid/lead_consolidation.json"),
        ("generic-result", "valid/generic_result.json"),
        ("exploratory-finding", "valid/exploratory_finding.json"),
        ("memory-record", "valid/memory_record.json"),
        ("auto-heal-record", "valid/auto_heal_record.json"),
        ("auto-heal-record", "valid/auto_heal_records.json"),
        ("qa-report-model", "valid/qa_report_model.json"),
    ]

    def test_all_valid_fixtures_pass(self):
        validator = vc.ContractValidator()
        for contract, rel in self.CASES:
            with self.subTest(contract=contract):
                result = validator.validate_artifact(fixture("valid", rel.split("/")[-1]), contract=contract)
                self.assertTrue(result.valid, [f.to_dict() for f in result.errors])
                self.assertEqual(result.contract, contract)
                self.assertGreaterEqual(result.record_count, 1)

    def test_registry_is_consistent(self):
        validator = vc.ContractValidator()
        contracts = validator.list_contracts()
        self.assertEqual(len(contracts), 18)
        for name in contracts:
            cfg = validator.store.contracts[name]
            self.assertTrue(os.path.exists(os.path.join(vc.SCHEMA_DIR, cfg["schema"])))


class InvalidFixturesTest(unittest.TestCase):
    # (contract, file, expected keyword, expected field)
    CASES = [
        ("test-case", "test_case_missing_required.json", "required", "test_cases[0].confidence"),
        ("test-case", "test_case_wrong_type.json", "type", "test_cases[0].steps"),
        ("test-result", "confidence_enum.json", "enum", "confidence"),
        ("failure-classification", "failure_classification_enum.json", "enum", "failure_classification"),
        ("reviewer-verdict", "reviewer_verdict_enum.json", "enum", "verdict"),
        ("bug-record", "bug_status_enum.json", "enum", "status"),
        ("test-result", "test_result_fail_without_classification.json", "required", "failure_classification"),
        ("bug-record", "bug_confirmed_without_evidence.json", "minItems", "evidence"),
        ("bug-record", "bug_confirmed_wrong_classification.json", "const", "failure_classification"),
        ("reviewer-verdict", "reviewer_accept_with_missing_evidence.json", "maxItems", "missing_evidence"),
        ("execution-trace", "execution_trace_success_without_validation.json", "required", "traces[0].result_validated"),
        ("execution-trace", "execution_trace_not_executed_but_success.json", "const", "traces[0].execution_success"),
        ("risk-record", "risk_high_without_reviewer.json", "const", "needs_qa_reviewer"),
        ("retest-record", "retest_fixed_not_pass.json", "const", "retest_result"),
        ("test-data-record", "test_data_available_unvalidated.json", "const", "validation.validated"),
        ("pre-flight-record", "preflight_blocked_no_reasons.json", "required", "blocked_reasons"),
        ("pre-flight-record", "preflight_capability_state_enum.json", "enum", "checks[0].capability_state"),
        ("pre-flight-record", "preflight_required_not_boolean.json", "type", "checks[0].required"),
        ("pre-flight-record", "preflight_observed_not_string.json", "type", "checks[0].observed"),
        ("pre-flight-record", "preflight_availability_source_enum.json", "enum", "checks[0].availability_source"),
        ("auto-heal-record", "auto_heal_recovered_without_selector.json", "required", "selector_used"),
        ("exploratory-finding", "exploratory_confirmed_without_evidence.json", "required", "evidence"),
        ("qa-report-model", "qa_report_model_fail_without_classification.json", "required", "results[0].classification"),
    ]

    def test_all_invalid_fixtures_fail_with_expected_reason(self):
        validator = vc.ContractValidator()
        for contract, name, keyword, field in self.CASES:
            with self.subTest(contract=contract, name=name):
                result = validator.validate_artifact(fixture("invalid", name), contract=contract)
                self.assertFalse(result.valid, f"{name} should be invalid")
                keywords = {f.keyword for f in result.errors}
                fields = {f.field for f in result.errors}
                self.assertIn(keyword, keywords,
                              f"{name}: expected keyword '{keyword}', got {sorted(keywords)}")
                self.assertIn(field, fields,
                              f"{name}: expected field '{field}', got {sorted(fields)}")


class StatePreservationTest(unittest.TestCase):
    def setUp(self):
        self.validator = vc.ContractValidator()

    def _validate_record(self, record, contract):
        return self.validator.validate_record(record, contract, "<inline>")

    def test_blocked_state_is_valid_and_preserved(self):
        record = {
            "preflight_id": "PF-100", "scope": "s",
            "checks": [{"check": "tools_available", "status": "BLOCKED"}],
            "result": "BLOCKED", "blocked_reasons": ["no browser"], "confidence": "HIGH",
        }
        self.assertEqual(self._validate_record(record, "pre-flight-record"), [])
        self.assertEqual(record["result"], "BLOCKED")

    def test_not_verified_state_is_valid_and_preserved(self):
        record = {
            "retest_id": "RT-100", "related_bug_id": "BUG-1", "related_test_case_id": "TC-1",
            "original_result": "FAIL", "retest_result": "NOT VERIFIED",
            "fix_status": "INDETERMINATE", "confidence": "LOW",
        }
        self.assertEqual(self._validate_record(record, "retest-record"), [])
        self.assertEqual(record["retest_result"], "NOT VERIFIED")

    def test_insufficient_evidence_state_is_valid_and_preserved(self):
        record = {
            "classification_id": "FC-100", "test_id": "TC-1", "result_status": "FAIL",
            "failure_classification": "INSUFFICIENT_EVIDENCE", "outcome": "INSUFFICIENT_EVIDENCE",
            "rationale": "not enough evidence", "confidence": "LOW",
            "confidence_rationale": "single non-reproducible observation",
        }
        self.assertEqual(self._validate_record(record, "failure-classification"), [])
        self.assertEqual(record["failure_classification"], "INSUFFICIENT_EVIDENCE")
        self.assertEqual(record["outcome"], "INSUFFICIENT_EVIDENCE")

    def test_insufficient_evidence_cannot_confirm_bug(self):
        record = {
            "classification_id": "FC-101", "test_id": "TC-1", "result_status": "FAIL",
            "failure_classification": "INSUFFICIENT_EVIDENCE", "outcome": "BUG_CONFIRMED",
            "related_bug_id": "BUG-1", "rationale": "r", "confidence": "LOW",
            "confidence_rationale": "c",
        }
        errors = self._validate_record(record, "failure-classification")
        self.assertTrue(errors)
        self.assertIn("enum", {f.keyword for f in errors})

    def test_reviewer_verdict_enum_is_exactly_three_values(self):
        for verdict in ("ACCEPT", "CHALLENGE", "INSUFFICIENT_EVIDENCE"):
            record = {
                "verdict": verdict, "confidence": "LOW", "confidence_rationale": "c",
                "reasoning_summary": "s", "evidence_references": ["qa/evidence/sample.png"],
            }
            if verdict != "ACCEPT":
                self.assertEqual(self._validate_record(record, "reviewer-verdict"), [])
            else:
                self.assertEqual(self._validate_record(record, "reviewer-verdict"), [])


class NoTransformationTest(unittest.TestCase):
    """The validator must never mutate or 'fix' an artifact."""

    def test_invalid_result_is_not_mutated_and_stays_fail(self):
        with open(fixture("invalid", "test_result_fail_without_classification.json"), encoding="utf-8") as fh:
            data = json.load(fh)
        before = copy.deepcopy(data)
        findings = vc.ContractValidator().validate_record(data, "test-result", "<inline>")
        self.assertTrue(findings, "expected validation errors")
        self.assertEqual(data, before, "validator mutated the record")
        self.assertEqual(data["status"], "FAIL", "status must not be rewritten")

    def test_invalid_bug_is_not_promoted(self):
        with open(fixture("invalid", "bug_confirmed_without_evidence.json"), encoding="utf-8") as fh:
            data = json.load(fh)
        before = copy.deepcopy(data)
        findings = vc.ContractValidator().validate_record(data, "bug-record", "<inline>")
        self.assertTrue(findings)
        self.assertEqual(data, before)
        self.assertEqual(data["status"], "CONFIRMED")
        self.assertEqual(data["evidence"], [], "evidence must not be synthesized")

    def test_validator_returns_only_findings(self):
        result = vc.ContractValidator().validate_artifact(
            fixture("valid", "bug_record_confirmed.json"), contract="bug-record")
        self.assertEqual(result.findings, [])
        self.assertTrue(result.valid)


class ReferenceIntegrityTest(unittest.TestCase):
    def test_dangling_references_are_detected(self):
        bundle = vc.ContractValidator().validate_bundle([os.path.join(FIXTURES, "bundle_invalid")])
        self.assertFalse(bundle.valid)
        errors = [f for f in bundle.reference_findings if f.severity == "error"]
        reasons = " ".join(f.reason for f in errors)
        self.assertIn("TC-404", reasons)
        self.assertIn("BUG-999", reasons)
        self.assertEqual(len(errors), 2, [f.to_dict() for f in errors])
        self.assertTrue(all(f.keyword == "reference" for f in errors))

    def test_bundle_invalid_artifacts_are_schema_valid(self):
        # Only the references are broken; the records themselves match their schemas.
        bundle = vc.ContractValidator().validate_bundle([os.path.join(FIXTURES, "bundle_invalid")])
        self.assertTrue(all(r.valid for r in bundle.results), [r.to_dict() for r in bundle.results])


class ExistingArtifactsTest(unittest.TestCase):
    """Compatibility: the artifacts already in qa/ must validate (or be flagged)."""

    CASES = [
        ("qa/tools/fixtures/valid/test_case.suite.json", "test-case", 1),
        ("qa/tools/fixtures/valid/risk_record.json", "risk-record", 1),
        ("qa/tools/fixtures/valid/bug_record_confirmed.json", "bug-record", 1),
        ("qa/tools/fixtures/valid/execution_trace.json", "execution-trace", 1),
    ]

    def test_existing_artifacts_validate(self):
        validator = vc.ContractValidator()
        for rel, contract, count in self.CASES:
            with self.subTest(artifact=rel):
                result = validator.validate_artifact(repo_relative(rel), contract=contract)
                self.assertTrue(result.valid, [f.to_dict() for f in result.errors])
                self.assertEqual(result.contract, contract)
                self.assertEqual(result.record_count, count)

    def test_contract_autodetection(self):
        validator = vc.ContractValidator()
        for rel, contract, _count in self.CASES:
            with self.subTest(artifact=rel):
                result = validator.validate_artifact(repo_relative(rel))
                self.assertEqual(result.contract, contract)

    def test_bundle_of_qa_is_valid(self):
        bundle = vc.ContractValidator().validate_bundle([repo_relative("qa")])
        self.assertTrue(bundle.valid, [f.to_dict() for f in bundle.errors])
        self.assertEqual(bundle.summary()["records"], 0)

    def test_report_model_hint_is_registered(self):
        hints = vc.ContractValidator().store.hints
        self.assertEqual(hints.get("report_model_id"), "qa-report-model")


class RunnerArtifactsDetectionTest(unittest.TestCase):
    """AUD-03: report.json and data_verification.json must be detected in --bundle.

    The runner writes both artifacts; if no hint maps their identifying keys to a
    contract, the bundle reports them as "unknown" (a warning) and never applies
    their schema, so an invalid artifact would pass unnoticed.
    """

    def test_registry_hints_map_runner_artifacts(self):
        hints = vc.ContractValidator().store.hints
        self.assertEqual(hints.get("report_id"), "execution-report")
        self.assertEqual(hints.get("verification_id"), "data-verification")

    def test_serialized_runner_artifacts_are_autodetected(self):
        validator = vc.ContractValidator()
        with tempfile.TemporaryDirectory() as tmp:
            report = os.path.join(tmp, "report.json")
            dv = os.path.join(tmp, "data_verification.json")
            with open(report, "w", encoding="utf-8") as fh:
                json.dump(valid_execution_report(), fh)
            with open(dv, "w", encoding="utf-8") as fh:
                json.dump([valid_data_verification()], fh)
            self.assertEqual(validator.validate_artifact(report).contract, "execution-report")
            self.assertEqual(validator.validate_artifact(dv).contract, "data-verification")
            self.assertTrue(validator.validate_artifact(report).valid)
            self.assertTrue(validator.validate_artifact(dv).valid)

    def test_bundle_detects_and_rejects_invalid_runner_artifacts(self):
        validator = vc.ContractValidator()
        with tempfile.TemporaryDirectory() as tmp:
            bad_report = valid_execution_report()
            bad_report.pop("summary")  # required property
            bad_dv = valid_data_verification()
            bad_dv["verification_id"] = "BAD-ID"  # violates ^DV-[A-Za-z0-9._-]+$
            with open(os.path.join(tmp, "report.json"), "w", encoding="utf-8") as fh:
                json.dump(bad_report, fh)
            with open(os.path.join(tmp, "data_verification.json"), "w", encoding="utf-8") as fh:
                json.dump([bad_dv], fh)

            bundle = validator.validate_bundle([tmp])
            self.assertFalse(bundle.valid)
            by_contract = {
                r.contract: r for r in bundle.results if r.artifact.endswith(".json")
            }
            self.assertIn("execution-report", by_contract)
            self.assertIn("data-verification", by_contract)
            self.assertFalse(by_contract["execution-report"].valid)
            self.assertFalse(by_contract["data-verification"].valid)
            # both produce explicit errors (not silent "unknown" warnings)
            self.assertTrue(any(f.severity == "error" for f in by_contract["execution-report"].errors))
            self.assertTrue(any(f.severity == "error" for f in by_contract["data-verification"].errors))


class SchemaSelfCheckTest(unittest.TestCase):
    """D1: the engine must not silently ignore unsupported schema keywords."""

    def issues(self, schema):
        return vc.verify_schema(schema, "test.schema.json")

    def assertKeyword(self, issues, keyword):
        self.assertTrue(issues, "expected at least one schema issue")
        self.assertIn(keyword, {i.keyword for i in issues})

    def test_pattern_properties_is_rejected(self):
        issues = self.issues({
            "type": "object",
            "patternProperties": {"^x": {"type": "integer"}},
        })
        self.assertKeyword(issues, "patternProperties")

    def test_contains_is_rejected(self):
        self.assertKeyword(
            self.issues({"type": "array", "contains": {"const": 1}}), "contains")

    def test_property_names_is_rejected(self):
        issues = self.issues({"type": "object", "propertyNames": {"pattern": "^[a-z]+$"}})
        self.assertKeyword(issues, "propertyNames")

    def test_anchor_keyword_is_rejected(self):
        # $anchor affects $ref resolution, which this engine does not implement.
        self.assertKeyword(self.issues({"$anchor": "root", "type": "object"}), "$anchor")

    def test_invalid_type_name_is_rejected(self):
        issues = self.issues({"type": "objectt"})
        self.assertKeyword(issues, "type")
        self.assertTrue(any("objectt" in i.reason for i in issues))

    def test_invalid_type_inside_combination_is_rejected(self):
        self.assertKeyword(self.issues({"type": ["string", "nope"]}), "type")

    def test_empty_type_array_is_rejected(self):
        self.assertKeyword(self.issues({"type": []}), "type")

    def test_unknown_keyword_is_rejected(self):
        issues = self.issues({"type": "object", "requird": ["x"]})
        self.assertTrue(any(i.keyword == "requird" for i in issues))

    def test_tuple_items_form_is_rejected(self):
        self.assertKeyword(
            self.issues({"type": "array", "items": [{"type": "string"}]}), "items")

    def test_custom_extension_is_allowed(self):
        self.assertEqual(self.issues({"type": "object", "x-internal": {"note": "ok"}}), [])

    def test_supported_keywords_are_accepted(self):
        issues = self.issues({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "title": "t", "description": "d",
            "$defs": {"s": {"type": "string", "minLength": 1}},
            "type": "object",
            "properties": {
                "a": {"$ref": "#/$defs/s"},
                "b": {"type": ["string", "null"]},
            },
            "required": ["a"],
            "additionalProperties": False,
            "allOf": [{"minProperties": 1}],
            "anyOf": [{"required": ["a"]}],
            "oneOf": [{"required": ["a"]}, {"required": ["b"]}],
            "not": {"required": ["c"]},
            "if": {"required": ["a"]},
            "then": {"minProperties": 1},
            "else": {"minProperties": 0},
        })
        self.assertEqual(issues, [])

    def test_schema_issues_are_traceable(self):
        issues = self.issues({
            "properties": {"x": {"type": "object", "contains": {"const": 1}}},
        })
        self.assertTrue(issues)
        issue = issues[0]
        self.assertEqual(issue.schema, "test.schema.json")
        self.assertEqual(issue.keyword, "contains")
        self.assertEqual(issue.location, "/properties/x/contains")
        self.assertTrue(issue.reason)
        self.assertEqual(issue.to_dict()["keyword"], "contains")

    def test_current_schemas_have_no_schema_issues(self):
        self.assertEqual(vc.ContractValidator().schema_issues, [])

    def test_contract_validator_refuses_unsupported_schema(self):
        # A schema directory with an unsupported keyword must abort startup so
        # no artifact can be reported VALID under an unevaluated rule.
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "bad.schema.json"), "w", encoding="utf-8") as fh:
                json.dump({"type": "object", "contains": {"const": 1}}, fh)
            tmp_index = os.path.join(tmp, "index.json")
            with open(tmp_index, "w", encoding="utf-8") as fh:
                json.dump({"contracts": {}}, fh)
            saved = vc.INDEX_FILE
            vc.INDEX_FILE = tmp_index
            try:
                with self.assertRaises(vc.ValidatorError):
                    vc.ContractValidator(schema_dir=tmp)
            finally:
                vc.INDEX_FILE = saved


class CliTest(unittest.TestCase):
    SCRIPT = os.path.join(HERE, "validate_contracts.py")

    def _run(self, *args):
        return subprocess.run([sys.executable, self.SCRIPT, *args],
                              capture_output=True, text=True)

    def test_list_exit_zero(self):
        proc = self._run("--list")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("test-case", proc.stdout)

    def test_unsupported_schema_dir_exits_two(self):
        # D1: a schema using an unimplemented standard keyword must abort with
        # an explicit, traceable error instead of validating under a skipped rule.
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "bad.schema.json"), "w", encoding="utf-8") as fh:
                json.dump({"type": "object", "contains": {"const": 1}}, fh)
            proc = self._run("--schema-dir", tmp, "--list")
            self.assertEqual(proc.returncode, 2, proc.stdout + proc.stderr)
            self.assertIn("FATAL", proc.stderr)
            self.assertIn("contains", proc.stderr)
            self.assertIn("bad.schema.json", proc.stderr)

    def test_valid_bundle_exit_zero(self):
        proc = self._run("--bundle", repo_relative("qa"))
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("RESULT: VALID", proc.stdout)

    def test_invalid_file_exit_one(self):
        proc = self._run("--contract", "bug-record", "--file",
                         fixture("invalid", "bug_status_enum.json"))
        self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
        self.assertIn("RESULT: INVALID", proc.stdout)

    def test_json_output_is_machine_readable(self):
        proc = self._run("--bundle", repo_relative("qa"), "--json")
        self.assertEqual(proc.returncode, 0)
        payload = json.loads(proc.stdout)
        self.assertTrue(payload["valid"])
        self.assertIn("summary", payload)


if __name__ == "__main__":
    unittest.main(verbosity=2)
