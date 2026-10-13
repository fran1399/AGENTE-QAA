#!/usr/bin/env python3
"""Automated tests for the M-02 execution report generator.

Run:
    python qa/tools/test_report_generator.py
    python -m unittest discover -s qa/tools -p "test_*.py" -v

Covers: JSON schema validity, report structure, HTML escaping, evidence
references, consistency between JSON and HTML, and secret leakage prevention.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SCHEMA_DIR = os.path.join(REPO_ROOT, "qa", "schema")

if HERE not in sys.path:
    sys.path.insert(0, HERE)

import validate_contracts as vc  # noqa: E402


def repo_relative(rel):
    return os.path.join(REPO_ROOT, rel)


class ExecutionReportSchemaTest(unittest.TestCase):
    """The execution-report schema must be valid and registered."""

    def test_schema_is_registered(self):
        validator = vc.ContractValidator()
        contracts = validator.list_contracts()
        self.assertIn("execution-report", contracts)

    def test_schema_self_check_passes(self):
        validator = vc.ContractValidator()
        issues = validator.store.verify()
        self.assertEqual(issues, [])

    def test_schema_file_exists(self):
        self.assertTrue(os.path.exists(os.path.join(SCHEMA_DIR, "execution-report.schema.json")))


class ExecutionReportValidationTest(unittest.TestCase):
    """Validate execution-report JSON against the M-01 contract."""

    def _make_valid_report(self):
        return {
            "report_id": "ER-20261010T120000000",
            "run_id": "R-20261010T120000000",
            "suite_id": "SUITE-demo-qaa-web",
            "app": "demo-qaa",
            "platform": "web",
            "started_at": "2026-10-10T12:00:00.000Z",
            "ended_at": "2026-10-10T12:00:05.000Z",
            "duration_ms": 5000,
            "overall_status": "PASS",
            "summary": {
                "selected": 2,
                "executed": 2,
                "passed": 2,
                "failed": 0,
                "errors": 0,
                "blocked": 0,
                "skipped": 0,
                "omitted": 0,
            },
            "cases": [
                {
                    "test_case_id": "TC-DEMO-WEB-1",
                    "title": "Home page loads",
                    "status": "PASS",
                    "duration_ms": 2500,
                    "spec": "automation/specs/demo-web/site.spec.ts",
                    "evidence": ["automation/.runs/suite/R-xxx/evidence/TC-DEMO-WEB-1_assertions.json"],
                },
                {
                    "test_case_id": "TC-DEMO-WEB-2",
                    "title": "Search works",
                    "status": "PASS",
                    "duration_ms": 2500,
                    "spec": "automation/specs/demo-web/site.spec.ts",
                    "evidence": [],
                },
            ],
            "preflight": {
                "result": "READY",
            },
            "infrastructure_errors": [],
            "evidence_index": [],
            "generated_at": "2026-10-10T12:00:05.000Z",
        }

    def test_valid_report_passes(self):
        validator = vc.ContractValidator()
        report = self._make_valid_report()
        findings = validator.validate_record(report, contract="execution-report")
        self.assertEqual(findings, [])

    def test_missing_required_field_fails(self):
        validator = vc.ContractValidator()
        report = self._make_valid_report()
        del report["overall_status"]
        findings = validator.validate_record(report, contract="execution-report")
        self.assertGreater(len(findings), 0)

    def test_invalid_status_enum_fails(self):
        validator = vc.ContractValidator()
        report = self._make_valid_report()
        report["overall_status"] = "INVALID"
        findings = validator.validate_record(report, contract="execution-report")
        self.assertGreater(len(findings), 0)

    def test_invalid_report_id_pattern_fails(self):
        validator = vc.ContractValidator()
        report = self._make_valid_report()
        report["report_id"] = "INVALID"
        findings = validator.validate_record(report, contract="execution-report")
        self.assertGreater(len(findings), 0)

    def test_blocked_report_valid(self):
        validator = vc.ContractValidator()
        report = self._make_valid_report()
        report["overall_status"] = "BLOCKED"
        report["summary"]["blocked"] = 2
        report["summary"]["passed"] = 0
        report["summary"]["executed"] = 0
        report["cases"][0]["status"] = "BLOCKED"
        report["cases"][0]["block_reason"] = "Pre-flight BLOCKED: credentials missing"
        report["cases"][1]["status"] = "BLOCKED"
        report["cases"][1]["block_reason"] = "Pre-flight BLOCKED: credentials missing"
        report["preflight"]["result"] = "BLOCKED"
        report["preflight"]["blocked_reasons"] = ["credentials missing"]
        findings = validator.validate_record(report, contract="execution-report")
        self.assertEqual(findings, [])

    def test_fail_report_valid(self):
        validator = vc.ContractValidator()
        report = self._make_valid_report()
        report["overall_status"] = "FAIL"
        report["summary"]["failed"] = 1
        report["summary"]["passed"] = 1
        report["cases"][1]["status"] = "FAIL"
        report["cases"][1]["error"] = "Expected element not found"
        findings = validator.validate_record(report, contract="execution-report")
        self.assertEqual(findings, [])

    def test_auto_healing_section_valid(self):
        validator = vc.ContractValidator()
        report = self._make_valid_report()
        report["auto_healing"] = {
            "mode": "HIGH_CONFIDENCE",
            "attempts": 3,
            "recoveries_used": 2,
            "reused": 1,
            "duplicate_prevented": 0,
            "ai_calls": 0,
        }
        findings = validator.validate_record(report, contract="execution-report")
        self.assertEqual(findings, [])

    def test_infrastructure_errors_valid(self):
        validator = vc.ContractValidator()
        report = self._make_valid_report()
        report["infrastructure_errors"] = ["Playwright timeout", "Server not reachable"]
        findings = validator.validate_record(report, contract="execution-report")
        self.assertEqual(findings, [])


class ExecutionReportIntegrationTest(unittest.TestCase):
    """Integration test: run the runner and verify report.json + report.html."""

    def test_runner_generates_reports(self):
        import time
        out = os.path.join(REPO_ROOT, "automation", ".artifacts", "m02-test", f"run-{int(time.time())}")
        os.makedirs(out, exist_ok=True)
        try:
            runner_js = repo_relative(os.path.join("automation", ".dist", "runner", "runner.js"))
            if not os.path.exists(runner_js):
                self.skipTest("Runner not built")
            result = subprocess.run(
                ["node", runner_js, "--suite", "SUITE-demo-qaa-web", "--out", out],
                capture_output=True, text=True, cwd=REPO_ROOT, timeout=120,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

            report_json_path = os.path.join(out, "report.json")
            report_html_path = os.path.join(out, "report.html")
            self.assertTrue(os.path.exists(report_json_path), "report.json not generated")
            self.assertTrue(os.path.exists(report_html_path), "report.html not generated")

            with open(report_json_path, "r", encoding="utf-8") as f:
                report = json.load(f)

            self.assertIn("report_id", report)
            self.assertIn("run_id", report)
            self.assertIn("suite_id", report)
            self.assertIn("overall_status", report)
            self.assertIn("summary", report)
            self.assertIn("cases", report)
            self.assertEqual(report["suite_id"], "SUITE-demo-qaa-web")
            self.assertEqual(report["overall_status"], "PASS")
            self.assertEqual(report["summary"]["passed"], 2)
            self.assertEqual(len(report["cases"]), 2)

            with open(report_html_path, "r", encoding="utf-8") as f:
                html = f.read()

            self.assertIn("SUITE-demo-qaa-web", html)
            self.assertIn("PASS", html)
            self.assertIn("TC-DEMO-WEB-1", html)
            self.assertIn("TC-DEMO-WEB-2", html)
            self.assertIn("<!DOCTYPE html>", html)

            validator = vc.ContractValidator()
            findings = validator.validate_record(report, contract="execution-report")
            self.assertEqual(findings, [])
        finally:
            import shutil
            shutil.rmtree(out, ignore_errors=True)


class HtmlEscapingTest(unittest.TestCase):
    """Verify that dynamic content is properly escaped in HTML."""

    def test_html_escaping_in_report(self):
        """Test that special characters in titles/errors are escaped."""
        out = os.path.join(REPO_ROOT, "automation", ".artifacts", "m02-escape-test", f"run-{int(__import__('time').time())}")
        os.makedirs(out, exist_ok=True)
        try:
            runner_js = repo_relative(os.path.join("automation", ".dist", "runner", "runner.js"))
            if not os.path.exists(runner_js):
                self.skipTest("Runner not built")

            manifest = {
                "suite_id": "SUITE-m02-escape-test",
                "app": "demo-qaa",
                "platform": "web",
                "adapter": "playwright",
                "web_server": {
                    "command": "node automation/scripts/serve-demo.mjs 4199",
                    "url": "http://127.0.0.1:4199/",
                    "timeout_ms": 15000,
                },
                "requirements": {
                    "task": "SUITE-m02-escape-test",
                    "scope": "M-02 escape test",
                    "platform": "web",
                    "need": {
                        "runtime": {"python": True, "node": True, "npm": True},
                        "adapters": ["playwright"],
                        "browsers": ["chromium"],
                        "tools": ["node", "npm"],
                        "target": {"url": "http://127.0.0.1:4199/", "method": "GET", "ok_status_max": 499, "timeout_ms": 5000},
                        "requires_evidence": True,
                        "qa_reviewer": {"required": False},
                    },
                },
                "test_cases": [
                    {
                        "test_case_id": "TC-M02-ESCAPE-1",
                        "title": "Test <script>alert('xss')</script> & \"quotes\"",
                        "spec": "automation/specs/demo-web/site.spec.ts",
                        "test_name": "home renders the product catalog",
                        "expected_result": "x",
                    },
                ],
            }
            manifest_path = os.path.join(out, "manifest.json")
            with open(manifest_path, "w", encoding="utf-8") as f:
                json.dump(manifest, f, indent=2)

            result = subprocess.run(
                ["node", runner_js, "--manifest", manifest_path, "--suite", "SUITE-m02-escape-test", "--out", out],
                capture_output=True, text=True, cwd=REPO_ROOT, timeout=120,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

            report_html_path = os.path.join(out, "report.html")
            self.assertTrue(os.path.exists(report_html_path))

            with open(report_html_path, "r", encoding="utf-8") as f:
                html = f.read()

            self.assertNotIn("<script>alert", html)
            self.assertIn("&lt;script&gt;", html)
            self.assertIn("&amp;", html)
            self.assertIn("&quot;", html)
        finally:
            import shutil
            shutil.rmtree(out, ignore_errors=True)


class SecretLeakageTest(unittest.TestCase):
    """Verify that no secrets or env vars leak into reports."""

    def test_no_secrets_in_report(self):
        """Test that sensitive env vars don't appear in report output."""
        out = os.path.join(REPO_ROOT, "automation", ".artifacts", "m02-secret-test", f"run-{int(__import__('time').time())}")
        os.makedirs(out, exist_ok=True)
        try:
            runner_js = repo_relative(os.path.join("automation", ".dist", "runner", "runner.js"))
            if not os.path.exists(runner_js):
                self.skipTest("Runner not built")

            env = os.environ.copy()
            env["QAA_SECRET_TOKEN"] = "super-secret-token-12345"
            env["QAA_API_KEY"] = "api-key-67890"
            env["PASSWORD"] = "my-password"

            result = subprocess.run(
                ["node", runner_js, "--suite", "SUITE-demo-qaa-web", "--out", out],
                capture_output=True, text=True, cwd=REPO_ROOT, timeout=120, env=env,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

            report_json_path = os.path.join(out, "report.json")
            report_html_path = os.path.join(out, "report.html")

            for path in [report_json_path, report_html_path]:
                if os.path.exists(path):
                    with open(path, "r", encoding="utf-8") as f:
                        content = f.read()
                    self.assertNotIn("super-secret-token-12345", content)
                    self.assertNotIn("api-key-67890", content)
                    self.assertNotIn("my-password", content)
        finally:
            import shutil
            shutil.rmtree(out, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
