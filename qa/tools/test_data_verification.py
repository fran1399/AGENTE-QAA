#!/usr/bin/env python3
"""Automated tests for the M-06 data verification contract.

Run:
    python qa/tools/test_data_verification.py
    python -m unittest discover -s qa/tools -p "test_*.py" -v

Covers: schema validity, contract registration, valid/invalid structures,
and integration with the M-01 validator.
"""
from __future__ import annotations

import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SCHEMA_DIR = os.path.join(REPO_ROOT, "qa", "schema")

if HERE not in sys.path:
    sys.path.insert(0, HERE)

import validate_contracts as vc  # noqa: E402


class DataVerificationSchemaTest(unittest.TestCase):
    """The data-verification schema must be valid and registered."""

    def test_schema_is_registered(self):
        validator = vc.ContractValidator()
        contracts = validator.list_contracts()
        self.assertIn("data-verification", contracts)

    def test_schema_self_check_passes(self):
        validator = vc.ContractValidator()
        issues = validator.store.verify()
        self.assertEqual(issues, [])

    def test_schema_file_exists(self):
        self.assertTrue(os.path.exists(os.path.join(SCHEMA_DIR, "data-verification.schema.json")))


class DataVerificationValidationTest(unittest.TestCase):
    """Validate data-verification JSON against the M-01 contract."""

    def _make_valid_result(self):
        return {
            "verification_id": "DV-001",
            "description": "Check product count",
            "status": "PASS",
            "query": "SELECT COUNT(*) as cnt FROM products",
            "params": [],
            "rows_returned": 1,
            "duration_ms": 15,
            "expected": {"type": "row_count", "count": 1},
            "actual": {"row_count": 1},
            "evidence": ["query: SELECT COUNT(*) as cnt FROM products"],
        }

    def test_valid_result_passes(self):
        validator = vc.ContractValidator()
        result = self._make_valid_result()
        findings = validator.validate_record(result, contract="data-verification")
        self.assertEqual(findings, [])

    def test_missing_required_field_fails(self):
        validator = vc.ContractValidator()
        result = self._make_valid_result()
        del result["status"]
        findings = validator.validate_record(result, contract="data-verification")
        self.assertGreater(len(findings), 0)

    def test_invalid_status_enum_fails(self):
        validator = vc.ContractValidator()
        result = self._make_valid_result()
        result["status"] = "INVALID"
        findings = validator.validate_record(result, contract="data-verification")
        self.assertGreater(len(findings), 0)

    def test_invalid_verification_id_pattern_fails(self):
        validator = vc.ContractValidator()
        result = self._make_valid_result()
        result["verification_id"] = "INVALID"
        findings = validator.validate_record(result, contract="data-verification")
        self.assertGreater(len(findings), 0)

    def test_fail_status_valid(self):
        validator = vc.ContractValidator()
        result = self._make_valid_result()
        result["status"] = "FAIL"
        result["error"] = "expected 5 rows, got 3"
        findings = validator.validate_record(result, contract="data-verification")
        self.assertEqual(findings, [])

    def test_error_status_valid(self):
        validator = vc.ContractValidator()
        result = self._make_valid_result()
        result["status"] = "ERROR"
        result["error"] = "database connection failed"
        findings = validator.validate_record(result, contract="data-verification")
        self.assertEqual(findings, [])

    def test_column_value_condition_valid(self):
        validator = vc.ContractValidator()
        result = self._make_valid_result()
        result["expected"] = {"type": "column_value", "column": "status", "value": "active", "operator": "="}
        result["actual"] = {"row_count": 1, "column_value": "active", "column_found": True}
        findings = validator.validate_record(result, contract="data-verification")
        self.assertEqual(findings, [])

    def test_not_empty_condition_valid(self):
        validator = vc.ContractValidator()
        result = self._make_valid_result()
        result["expected"] = {"type": "not_empty"}
        findings = validator.validate_record(result, contract="data-verification")
        self.assertEqual(findings, [])

    def test_empty_condition_valid(self):
        validator = vc.ContractValidator()
        result = self._make_valid_result()
        result["expected"] = {"type": "empty"}
        result["rows_returned"] = 0
        result["actual"] = {"row_count": 0}
        findings = validator.validate_record(result, contract="data-verification")
        self.assertEqual(findings, [])

    def test_invalid_expected_type_fails(self):
        validator = vc.ContractValidator()
        result = self._make_valid_result()
        result["expected"] = {"type": "invalid_type"}
        findings = validator.validate_record(result, contract="data-verification")
        self.assertGreater(len(findings), 0)

    def test_invalid_operator_fails(self):
        validator = vc.ContractValidator()
        result = self._make_valid_result()
        result["expected"] = {"type": "column_value", "column": "x", "value": 1, "operator": "invalid"}
        findings = validator.validate_record(result, contract="data-verification")
        self.assertGreater(len(findings), 0)


if __name__ == "__main__":
    unittest.main()
