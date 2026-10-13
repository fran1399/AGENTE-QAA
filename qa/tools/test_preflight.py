#!/usr/bin/env python3
"""Automated tests for the M-04 pre-flight capability detector.

Run:
    python qa/tools/test_preflight.py
    python -m unittest discover -s qa/tools -p "test_*.py" -v

Isolation: the target-reachability checks use a local ephemeral HTTP server or a
closed local port; Test Data uses local fixtures. No external application is
contacted.
"""
from __future__ import annotations

import contextlib
import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
FIXTURES = os.path.join(HERE, "fixtures", "preflight")

if HERE not in sys.path:
    sys.path.insert(0, HERE)

import preflight  # noqa: E402


def fixture(name: str) -> str:
    return os.path.join(FIXTURES, name)


def repo_relative(rel: str) -> str:
    return os.path.join(REPO_ROOT, rel)


def base_environ():
    """Process environment with the per-user Node.js directory on PATH if present."""
    env = dict(os.environ)
    local = env.get("LOCALAPPDATA")
    if local:
        node_dir = os.path.join(local, "Programs", "nodejs")
        if os.path.isdir(node_dir):
            env["PATH"] = node_dir + os.pathsep + env.get("PATH", "")
    return env


def data_file(*parts: str) -> str:
    """Repo-relative path to a pre-flight fixture (forward and back slashes accepted)."""
    return "/".join(("qa", "tools", "fixtures", "preflight", *parts))


@contextlib.contextmanager
def http_server():
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")

        def log_message(self, *args):  # silence
            return

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@contextlib.contextmanager
def http_server_status(status: int):
    """Local HTTP server answering GET with a configurable status code."""

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            self.send_response(status)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"probe")

        def log_message(self, *args):  # silence
            return

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def closed_port() -> int:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


class PreflightTestCase(unittest.TestCase):
    def run_preflight(self, req, **kwargs):
        kwargs.setdefault("repo_root", REPO_ROOT)
        kwargs.setdefault("environ", base_environ())
        return preflight.run_preflight(req, **kwargs)

    def checks_by_capability(self, record):
        return {check["capability"]: check for check in record["checks"]}

    def assertValidContract(self, record):
        findings = preflight.validate_record(record)
        self.assertEqual(findings, [], [f.to_dict() for f in findings])


class ReadyTest(PreflightTestCase):
    def test_ready_environment(self):
        with http_server() as url:
            req = {
                "task": "TC-READY",
                "need": {
                    "runtime": {"python": True},
                    "target": {"url": url, "method": "GET"},
                    "test_data": [{"data_id": "TD-PF-1", "file": data_file("testdata_available.json")}],
                    "evidence_dir": "qa/evidence",
                },
            }
            record = self.run_preflight(req)
        self.assertEqual(record["result"], "READY")
        self.assertNotIn("blocked_reasons", record)
        self.assertValidContract(record)

    def test_full_playwright_preflight_ready(self):
        env = base_environ()
        if not shutil.which("node", path=env.get("PATH")):
            self.skipTest("node not available in this environment")
        if not os.path.isfile(repo_relative(os.path.join("node_modules", "@playwright", "test", "package.json"))):
            self.skipTest("@playwright/test not installed")
        req = {
            "task": "TC-FULL-WEB",
            "need": {
                "runtime": {"python": True, "node": True, "npm": True},
                "node_packages": ["@playwright/test"],
                "adapters": ["playwright"],
                "browsers": ["chromium"],
                "evidence_dir": "qa/evidence",
            },
        }
        record = self.run_preflight(req)
        self.assertEqual(record["result"], "READY", record.get("blocked_reasons"))
        self.assertValidContract(record)


class BlockedRuntimeTest(PreflightTestCase):
    def test_runtime_below_minimum_is_blocked(self):
        record = self.run_preflight({"task": "TC-MIN", "need": {"runtime": {"python": True, "python_min": [99, 0]}}})
        self.assertEqual(record["result"], "BLOCKED")
        check = self.checks_by_capability(record)["runtime_python"]
        self.assertEqual(check["capability_state"], "REQUIRES_CONFIGURATION")
        self.assertValidContract(record)

    def test_missing_declared_dependency_is_blocked(self):
        req = {"task": "TC-DEP", "need": {"runtime": {"node": True}, "node_packages": ["@does-not-exist-zzz"]}}
        record = self.run_preflight(req)
        self.assertEqual(record["result"], "BLOCKED")
        check = self.checks_by_capability(record)["node_package_@does-not-exist-zzz"]
        self.assertEqual(check["capability_state"], "NOT_INSTALLED")
        self.assertValidContract(record)


class BlockedToolTest(PreflightTestCase):
    def test_missing_tool_is_blocked(self):
        record = self.run_preflight({"task": "TC-TOOL", "need": {"tools": ["definitely-not-a-real-tool-zzz"]}})
        self.assertEqual(record["result"], "BLOCKED")
        check = self.checks_by_capability(record)["tool_definitely-not-a-real-tool-zzz"]
        self.assertEqual(check["capability_state"], "NOT_INSTALLED")
        self.assertValidContract(record)


class CredentialsTest(PreflightTestCase):
    def test_required_credential_absent_is_blocked_and_named(self):
        name = "QAA_PF_ABSENT_SECRET"
        env = base_environ()
        env.pop(name, None)
        record = self.run_preflight({"task": "TC-CRED", "need": {"credentials": [name], "requires_evidence": False}},
                                    environ=env)
        self.assertEqual(record["result"], "BLOCKED")
        text = json.dumps(record)
        self.assertIn(name, text)
        self.assertEqual(self.checks_by_capability(record)[f"credential_{name}"]["capability_state"],
                         "REQUIRES_CONFIGURATION")
        self.assertValidContract(record)

    def test_present_credential_value_is_not_exposed(self):
        name = "QAA_PF_PRESENT_SECRET"
        secret = "s3cr3t-value-xyz-do-not-leak"
        env = base_environ()
        env[name] = secret
        record = self.run_preflight({"task": "TC-CRED2", "need": {"credentials": [name], "requires_evidence": False}},
                                    environ=env)
        self.assertEqual(record["result"], "READY")
        self.assertNotIn(secret, json.dumps(record))


class TargetTest(PreflightTestCase):
    def test_unreachable_target_is_blocked(self):
        port = closed_port()
        req = {"task": "TC-TARGET", "need": {"target": {"url": f"http://127.0.0.1:{port}/", "timeout_ms": 1500},
                                             "requires_evidence": False}}
        record = self.run_preflight(req)
        self.assertEqual(record["result"], "BLOCKED")
        self.assertEqual(self.checks_by_capability(record)["target_access"]["capability_state"],
                         "REQUIRES_CONFIGURATION")
        self.assertValidContract(record)


class TargetProbePolicyTest(PreflightTestCase):
    """M-04 probe semantics: HTTP 200 confirms access, HTTP 403 is never a
    functional confirmation, and the explicit `browser_fallback` policy turns
    denied/inconclusive probes into non-blocking WARNs decided by the browser
    navigation evidence (never by the probe, never confused with a TC PASS)."""

    def _target(self, url, **extra):
        return self.run_preflight({"task": "TC-PROBE", "need": {
            "target": {"url": url, **extra}, "requires_evidence": False}})

    def test_http_200_is_functional_confirmation(self):
        with http_server_status(200) as url:
            record = self._target(url)
        check = self.checks_by_capability(record)["target_access"]
        self.assertEqual(record["result"], "READY")
        self.assertEqual(check["status"], "OK")
        self.assertEqual(check["capability_state"], "AVAILABLE")
        self.assertIn("HTTP 200", check["observed"])
        self.assertValidContract(record)

    def test_http_403_is_not_confirmation_and_blocks_by_default(self):
        with http_server_status(403) as url:
            record = self._target(url)
        self.assertEqual(record["result"], "BLOCKED")
        check = self.checks_by_capability(record)["target_access"]
        self.assertEqual(check["capability_state"], "REQUIRES_CONFIGURATION")
        self.assertNotEqual(check["capability_state"], "AVAILABLE")
        self.assertIn("403", check["observed"])
        self.assertIn("not a functional confirmation", check["observed"])
        self.assertIn("browser_fallback", (check.get("action") or ""))
        self.assertTrue(record.get("blocked_reasons"))
        self.assertValidContract(record)

    def test_http_403_with_browser_fallback_is_pending_warn_not_blocking(self):
        with http_server_status(403) as url:
            record = self._target(url, browser_fallback=True)
        self.assertEqual(record["result"], "READY")
        self.assertNotIn("blocked_reasons", record)
        check = self.checks_by_capability(record)["target_access"]
        self.assertEqual(check["status"], "WARN")
        self.assertEqual(check["capability_state"], "PROBE_DENIED")
        self.assertEqual(check["observed_state"], "PROBE_DENIED")
        self.assertIn("confirmed by browser execution", check["observed"])
        self.assertIn("never stands for a Test Case PASS", check["detail"])
        self.assertEqual(record["confidence"], "MEDIUM")
        self.assertValidContract(record)

    def test_connection_error_with_browser_fallback_is_inconclusive_warn(self):
        port = closed_port()
        record = self._target(f"http://127.0.0.1:{port}/", browser_fallback=True, timeout_ms=1500)
        self.assertEqual(record["result"], "READY")
        self.assertNotIn("blocked_reasons", record)
        check = self.checks_by_capability(record)["target_access"]
        self.assertEqual(check["status"], "WARN")
        self.assertEqual(check["capability_state"], "PROBE_INCONCLUSIVE")
        self.assertEqual(check["observed_state"], "PROBE_INCONCLUSIVE")
        self.assertEqual(record["confidence"], "MEDIUM")
        self.assertValidContract(record)

    def test_http_500_blocks_even_with_browser_fallback(self):
        with http_server_status(500) as url:
            record = self._target(url, browser_fallback=True)
        self.assertEqual(record["result"], "BLOCKED")
        check = self.checks_by_capability(record)["target_access"]
        self.assertEqual(check["capability_state"], "REQUIRES_CONFIGURATION")
        self.assertIn("500", check["observed"])
        self.assertValidContract(record)

    def test_connection_error_blocks_by_default(self):
        port = closed_port()
        record = self._target(f"http://127.0.0.1:{port}/", timeout_ms=1500)
        self.assertEqual(record["result"], "BLOCKED")
        self.assertEqual(self.checks_by_capability(record)["target_access"]["capability_state"],
                         "REQUIRES_CONFIGURATION")

    def test_browser_fallback_flag_must_be_boolean(self):
        with self.assertRaises(preflight.PreflightError):
            preflight.validate_requirements(
                {"task": "TC-BF-TYPE", "need": {"target": {"url": "http://x/", "browser_fallback": "yes"}}})

    def test_allowed_status_403_is_explicit_confirmation(self):
        with http_server_status(403) as url:
            record = self._target(url, allowed_status=[403])
        self.assertEqual(record["result"], "READY")
        self.assertEqual(self.checks_by_capability(record)["target_access"]["capability_state"],
                         "AVAILABLE")


class BrowserTest(PreflightTestCase):
    def test_required_browser_not_installed_is_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            req = {"task": "TC-BROWSER", "need": {"browsers": ["firefox"], "requires_evidence": False}}
            record = self.run_preflight(req, browsers_dir=tmp)
        self.assertEqual(record["result"], "BLOCKED")
        checks = self.checks_by_capability(record)
        self.assertEqual(checks["browser_firefox"]["capability_state"], "NOT_INSTALLED")
        # chromium is not required: it is recorded but never blocks
        self.assertEqual(checks["browser_chromium"]["capability_state"], "NOT_REQUIRED")
        self.assertValidContract(record)


class TestDataTest(PreflightTestCase):
    def test_unvalidated_test_data_is_blocked(self):
        req = {"task": "TC-DATA", "need": {
            "test_data": [{"data_id": "TD-PF-2", "file": data_file("testdata_unvalidated.json")}],
            "requires_evidence": False}}
        record = self.run_preflight(req)
        self.assertEqual(record["result"], "BLOCKED")
        self.assertEqual(self.checks_by_capability(record)["test_data_TD-PF-2"]["capability_state"],
                         "REQUIRES_CONFIGURATION")
        self.assertValidContract(record)

    def test_missing_test_data_record_is_blocked(self):
        req = {"task": "TC-DATA2", "need": {
            "test_data": [{"data_id": "TD-NOPE", "file": data_file("testdata_available.json")}],
            "requires_evidence": False}}
        record = self.run_preflight(req)
        self.assertEqual(record["result"], "BLOCKED")
        self.assertEqual(self.checks_by_capability(record)["test_data_TD-NOPE"]["capability_state"],
                         "REQUIRES_CONFIGURATION")


class EvidenceTest(PreflightTestCase):
    def test_evidence_path_that_is_a_file_is_blocked(self):
        req = {"task": "TC-EVIDENCE", "need": {"evidence_dir": data_file("not_a_dir.txt")}}
        record = self.run_preflight(req)
        self.assertEqual(record["result"], "BLOCKED")
        self.assertEqual(self.checks_by_capability(record)["evidence_write"]["capability_state"],
                         "REQUIRES_CONFIGURATION")
        self.assertValidContract(record)


class ReviewerTest(PreflightTestCase):
    def test_required_reviewer_unavailable_is_blocked_unverified(self):
        env = base_environ()
        env.pop("QAA_QA_REVIEWER_AVAILABLE", None)
        record = self.run_preflight({"task": "TC-REV", "need": {"qa_reviewer": {"required": True},
                                                               "requires_evidence": False}}, environ=env)
        self.assertEqual(record["result"], "BLOCKED")
        check = self.checks_by_capability(record)["qa_reviewer"]
        self.assertEqual(check["capability_state"], "UNVERIFIED")
        self.assertEqual(check["availability_source"], "declarative_signal")
        self.assertIn("does not probe the QA Reviewer", check["detail"])
        self.assertEqual(record["confidence"], "MEDIUM")
        self.assertValidContract(record)

    def test_high_risk_requires_reviewer(self):
        env = base_environ()
        env.pop("QAA_QA_REVIEWER_AVAILABLE", None)
        record = self.run_preflight({"task": "TC-REV-RISK", "need": {"qa_reviewer": {"risk_level": "HIGH"},
                                                                    "requires_evidence": False}}, environ=env)
        self.assertEqual(record["result"], "BLOCKED")
        self.assertTrue(self.checks_by_capability(record)["qa_reviewer"]["required"])

    def test_available_reviewer_signal_is_ready(self):
        env = base_environ()
        env["QAA_QA_REVIEWER_AVAILABLE"] = "1"
        record = self.run_preflight({"task": "TC-REV-OK", "need": {"qa_reviewer": {"required": True},
                                                                  "requires_evidence": False}}, environ=env)
        self.assertEqual(record["result"], "READY")
        check = self.checks_by_capability(record)["qa_reviewer"]
        self.assertEqual(check["capability_state"], "AVAILABLE")
        self.assertEqual(check["availability_source"], "declarative_signal")
        self.assertIn("operator-declared", check["observed"])
        self.assertIn("not automatically verified", check["observed"])
        self.assertValidContract(record)

    def test_reviewer_signal_is_declarative_not_an_automatic_probe(self):
        # The detector never claims to have probed the reviewer: it records the
        # evidence source as a declarative operator signal.
        env = base_environ()
        env["QAA_QA_REVIEWER_AVAILABLE"] = "1"
        record = self.run_preflight({"task": "TC-REV-SRC", "need": {"qa_reviewer": {"required": True},
                                                                   "requires_evidence": False}}, environ=env)
        check = self.checks_by_capability(record)["qa_reviewer"]
        self.assertEqual(check["availability_source"], "declarative_signal")
        self.assertNotIn("direct_probe", json.dumps(record))
        # A mandatory review with the signal absent must not be treated as available.
        env.pop("QAA_QA_REVIEWER_AVAILABLE", None)
        blocked = self.run_preflight({"task": "TC-REV-SRC2", "need": {"qa_reviewer": {"required": True},
                                                                     "requires_evidence": False}}, environ=env)
        self.assertEqual(blocked["result"], "BLOCKED")
        self.assertEqual(self.checks_by_capability(blocked)["qa_reviewer"]["capability_state"], "UNVERIFIED")

    def test_reviewer_not_required_does_not_block(self):
        env = base_environ()
        env.pop("QAA_QA_REVIEWER_AVAILABLE", None)
        record = self.run_preflight({"task": "TC-REV-NA", "need": {"requires_evidence": False}}, environ=env)
        self.assertEqual(record["result"], "READY")
        self.assertEqual(self.checks_by_capability(record)["qa_reviewer"]["capability_state"], "NOT_REQUIRED")


class OptionalCapabilityTest(PreflightTestCase):
    def test_optional_missing_capabilities_do_not_block(self):
        with tempfile.TemporaryDirectory() as tmp:
            record = self.run_preflight({"task": "TC-OPTIONAL", "need": {"runtime": {"python": True}}},
                                        browsers_dir=tmp)
        self.assertEqual(record["result"], "READY")
        checks = self.checks_by_capability(record)
        firefox = checks["browser_firefox"]
        self.assertEqual(firefox["capability_state"], "NOT_REQUIRED")
        self.assertEqual(firefox["observed_state"], "NOT_INSTALLED")
        self.assertValidContract(record)


class ContractGateTest(PreflightTestCase):
    def test_produced_record_is_valid_under_m01(self):
        record = self.run_preflight({"task": "TC-M01", "need": {}})
        self.assertValidContract(record)

    def test_invalid_preflight_record_is_rejected_by_m01(self):
        invalid = {
            "preflight_id": "PF-BAD",
            "scope": "s",
            "checks": [{"check": "tools_available", "status": "BLOCKED"}],
            "result": "BLOCKED",
            "confidence": "HIGH",
        }
        findings = preflight.validate_record(invalid)
        self.assertTrue(findings)
        self.assertIn("blocked_reasons", {f.field for f in findings})


class PreflightFieldsSchemaTest(PreflightTestCase):
    """M-04 acceptance: the extended check fields are structurally validated by M-01."""

    STATES = ("AVAILABLE", "REQUIRES_CONFIGURATION", "NOT_INSTALLED", "NOT_REQUIRED",
              "UNVERIFIED", "PROBE_DENIED", "PROBE_INCONCLUSIVE")
    LEGACY = os.path.join(HERE, "fixtures", "valid", "preflight_blocked.json")

    def _record_with(self, **mutations):
        record = self.run_preflight({"task": "TC-FIELDS",
                                     "need": {"tools": ["node"], "requires_evidence": False}})
        record["checks"][0].update(mutations)
        return record

    def test_generated_checks_carry_validated_fields(self):
        record = self.run_preflight({"task": "TC-FIELDS2", "need": {"runtime": {"python": True}}})
        for check in record["checks"]:
            self.assertTrue(check.get("capability"))
            self.assertIn(check["capability_state"], self.STATES)
            self.assertIn(check["observed_state"], self.STATES)
            self.assertIsInstance(check["required"], bool)
            self.assertIsInstance(check["observed"], str)
        self.assertValidContract(record)

    def test_legacy_record_without_extended_fields_is_compatible(self):
        with open(self.LEGACY, encoding="utf-8") as fh:
            legacy = json.load(fh)
        self.assertEqual(preflight.validate_record(legacy), [])

    def test_invalid_capability_state_is_rejected(self):
        record = self._record_with(capability_state="READY")
        findings = preflight.validate_record(record)
        self.assertTrue(findings)
        self.assertIn("enum", {f.keyword for f in findings})
        self.assertIn("checks[0].capability_state", {f.field for f in findings})

    def test_invalid_observed_state_is_rejected(self):
        record = self._record_with(observed_state="READY")
        findings = preflight.validate_record(record)
        self.assertIn("enum", {f.keyword for f in findings})
        self.assertIn("checks[0].observed_state", {f.field for f in findings})

    def test_invalid_required_type_is_rejected(self):
        record = self._record_with(required="yes")
        findings = preflight.validate_record(record)
        self.assertIn("type", {f.keyword for f in findings})
        self.assertIn("checks[0].required", {f.field for f in findings})

    def test_invalid_observed_type_is_rejected(self):
        record = self._record_with(observed=["node"])
        findings = preflight.validate_record(record)
        self.assertIn("type", {f.keyword for f in findings})
        self.assertIn("checks[0].observed", {f.field for f in findings})

    def test_invalid_action_type_is_rejected(self):
        record = self._record_with(action=123)
        findings = preflight.validate_record(record)
        self.assertIn("type", {f.keyword for f in findings})
        self.assertIn("checks[0].action", {f.field for f in findings})

    def test_invalid_availability_source_is_rejected(self):
        record = self._record_with(availability_source="guessed")
        findings = preflight.validate_record(record)
        self.assertIn("enum", {f.keyword for f in findings})
        self.assertIn("checks[0].availability_source", {f.field for f in findings})


class AutoHealingTest(PreflightTestCase):
    """M-05: the pre-flight detects and validates the auto-healing capability.

    OFF is declared-but-disabled (NOT_REQUIRED semantically, never blocks);
    OBSERVE/HIGH_CONFIDENCE with a valid configuration are AVAILABLE (declarative:
    the engine is bundled with the Playwright adapter); invalid configurations are
    REQUIRES_CONFIGURATION and block."""

    def _record(self, auto_healing):
        return self.run_preflight(
            {"task": "TC-HEAL-PF", "need": {"auto_healing": auto_healing, "requires_evidence": False}})

    def _check(self, record):
        return self.checks_by_capability(record)["auto_healing"]

    def test_absent_auto_healing_is_not_required(self):
        record = self.run_preflight({"task": "TC-HEAL-PF", "need": {"requires_evidence": False}})
        self.assertEqual(record["result"], "READY")
        check = self.checks_by_capability(record)["auto_healing"]
        self.assertEqual(check["status"], "NOT_APPLICABLE")
        self.assertEqual(check["capability_state"], "NOT_REQUIRED")
        self.assertValidContract(record)

    def test_off_mode_is_declared_but_not_required(self):
        record = self._record({"mode": "OFF"})
        self.assertEqual(record["result"], "READY")
        check = self._check(record)
        self.assertEqual(check["capability_state"], "NOT_REQUIRED")
        self.assertEqual(check["observed_state"], "AVAILABLE")
        self.assertEqual(check["required"], False)
        self.assertIn("disabled", check["observed"])
        self.assertValidContract(record)

    def test_observe_mode_is_available(self):
        record = self._record({"mode": "OBSERVE"})
        self.assertEqual(record["result"], "READY")
        check = self._check(record)
        self.assertEqual(check["status"], "OK")
        self.assertEqual(check["capability_state"], "AVAILABLE")
        self.assertEqual(check["required"], True)
        self.assertIn("never used", check["observed"])
        self.assertValidContract(record)

    def test_high_confidence_mode_is_available_with_store(self):
        record = self._record({"mode": "HIGH_CONFIDENCE", "store": "automation/.healing/store.json"})
        self.assertEqual(record["result"], "READY")
        check = self._check(record)
        self.assertEqual(check["capability_state"], "AVAILABLE")
        self.assertEqual(check["required"], True)
        self.assertIn("HIGH_CONFIDENCE", check["observed"])
        self.assertValidContract(record)

    def test_invalid_mode_is_rejected_as_configuration_error(self):
        # Structurally invalid configuration is a fatal requirements error
        # (same semantics as target.browser_fallback=yes), never a silent run.
        with self.assertRaises(preflight.PreflightError):
            self._record({"mode": "ALWAYS"})

    def test_direct_detector_call_blocks_invalid_mode(self):
        # Defense-in-depth: if the detector is invoked directly with an invalid
        # configuration, the record is an honest BLOCKED/REQUIRES_CONFIGURATION.
        req = {"task": "TC-HEAL-DIRECT", "need": {"auto_healing": {"mode": "ALWAYS"}, "requires_evidence": False}}
        detector = preflight.Detector(repo_root=REPO_ROOT, environ=base_environ())
        detector.evaluate(req)
        record = detector.record(req)
        self.assertEqual(record["result"], "BLOCKED")
        check = self.checks_by_capability(record)["auto_healing"]
        self.assertEqual(check["capability_state"], "REQUIRES_CONFIGURATION")
        self.assertTrue(record.get("blocked_reasons"))
        self.assertValidContract(record)

    def test_non_string_store_is_rejected_as_configuration_error(self):
        with self.assertRaises(preflight.PreflightError):
            self._record({"mode": "OBSERVE", "store": 42})

    def test_auto_healing_must_be_object(self):
        with self.assertRaises(preflight.PreflightError):
            preflight.validate_requirements(
                {"task": "TC-HEAL-TYPE", "need": {"auto_healing": ["OBSERVE"]}})


class CliTest(unittest.TestCase):
    SCRIPT = os.path.join(HERE, "preflight.py")

    def _run(self, *args):
        return subprocess.run([sys.executable, self.SCRIPT, *args],
                              capture_output=True, text=True)

    def _write(self, tmp, payload):
        path = os.path.join(tmp, "requirements.json")
        with open(path, "w", encoding="utf-8") as fh:
            if isinstance(payload, str):
                fh.write(payload)
            else:
                json.dump(payload, fh)
        return path

    def test_cli_ready_exits_zero_and_writes_valid_record(self):
        with http_server() as url, tempfile.TemporaryDirectory() as tmp:
            req = {
                "task": "TC-CLI",
                "need": {
                    "runtime": {"python": True},
                    "target": {"url": url},
                    "test_data": [{"data_id": "TD-PF-1", "file": data_file("testdata_available.json")}],
                },
            }
            req_path = self._write(tmp, req)
            out_path = os.path.join(tmp, "record.json")
            proc = self._run("--requirements", req_path, "--out", out_path, "--json")
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            payload = json.loads(proc.stdout)
            self.assertEqual(payload["result"], "READY")
            self.assertTrue(os.path.isfile(out_path))
            with open(out_path, encoding="utf-8") as fh:
                written = json.load(fh)
            self.assertEqual(written["result"], "READY")
            self.assertEqual(preflight.validate_record(written), [])

    def test_cli_blocked_exits_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            req_path = self._write(tmp, {"task": "TC-CLI-BLOCKED", "need": {"tools": ["no-such-tool-zzz"]}})
            proc = self._run("--requirements", req_path)
            self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
            self.assertIn("RESULT: BLOCKED", proc.stdout)
            self.assertIn("no-such-tool-zzz", proc.stdout)

    def test_cli_invalid_json_exits_two(self):
        with tempfile.TemporaryDirectory() as tmp:
            req_path = self._write(tmp, "{ this is not json")
            proc = self._run("--requirements", req_path)
            self.assertEqual(proc.returncode, 2, proc.stdout + proc.stderr)
            self.assertIn("FATAL", proc.stderr)

    def test_cli_missing_task_exits_two(self):
        with tempfile.TemporaryDirectory() as tmp:
            req_path = self._write(tmp, {"need": {}})
            proc = self._run("--requirements", req_path)
            self.assertEqual(proc.returncode, 2, proc.stdout + proc.stderr)
            self.assertIn("task", proc.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
