#!/usr/bin/env python3
"""Tests for the shared QA report renderer (`qa/tools/render_qa_report.py`).

Run:
    python qa/tools/test_render_qa_report.py
    python -m unittest discover -s qa/tools -p "test_*.py" -v

Covers: the `qa-report-model` contract and its detection, the derived metrics,
HTML section labels in the user's language, the optional sections, and the FAST
chat summary generated from the same model (chat and HTML stay consistent).
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import render_qa_report as rr  # noqa: E402
import validate_contracts as vc  # noqa: E402

# Fixture genérico para tests del contrato qa-report-model.
SAMPLE_MODEL = os.path.join(REPO_ROOT, "qa", "tools", "fixtures", "valid", "qa_report_model.json")


def sample_model() -> dict:
    """Self-contained model: 2 PASS, 1 FAIL(APP_BUG), 1 NOT VERIFIED row + 2 listed."""
    return {
        "report_model_id": "QRM-test-sample",
        "source_artifacts": [{"path": "automation/.runs/test/result.json", "note": "origin"}],
        "meta": {"title": "Sample", "status": "FAIL", "mode": "FAST", "status_note": "sample note"},
        "executive_summary": {"tested": "T", "worked": "W", "problems": "P", "unverified": "U", "report": "out.html"},
        "scope": {"in": "IN", "out": "OUT"},
        "preflight": {"result": "READY", "checks": [{"label": "Adapter", "value": "ok"}]},
        "results": [
            {"id": "TC-1", "title": "a", "status": "PASS", "confidence": "HIGH"},
            {"id": "TC-2", "title": "b", "status": "FAIL", "confidence": "HIGH", "classification": "APP_BUG"},
            {"id": "TC-3", "title": "c", "status": "NOT VERIFIED"},
        ],
        "failure_classifications": [
            {"test_id": "TC-2", "classification": "APP_BUG", "outcome": "BUG_CONFIRMED", "is_bug": True, "rationale": "r"},
        ],
        "bugs": {
            "confirmed": [{"id": "BUG-1", "title": "b", "severity": "HIGH", "priority": "P2", "confidence": "HIGH"}],
            "investigated": [{"id": "TC-9", "title": "x", "outcome": "NOT_A_BUG", "confidence": "HIGH"}],
        },
        "risks": [
            {"id": "R-1", "title": "low", "level": "LOW", "impact": "LOW", "probability": "LOW", "priority": "P3", "confidence": "HIGH"},
            {"id": "R-2", "title": "medium", "level": "MEDIUM", "impact": "MEDIUM", "probability": "MEDIUM", "priority": "P2", "confidence": "HIGH"},
        ],
        "evidence": [{"path": "qa/reports/sample.json", "label": "sample", "type": "text"}],
        "not_verified": ["one", "two"],
        "traceability": {"adapter": "playwright-qa", "steps": ["tool_requested", "result_validated"], "note": "n"},
        "reviewer": {"status": "BLOCKED", "verdict": "NOT EXECUTED", "reason": "r", "impact": "i"},
        "conclusion": ["c"],
    }


class SampleModelContractTest(unittest.TestCase):
    def test_sample_model_matches_contract(self):
        findings = vc.ContractValidator().validate_record(sample_model(), "qa-report-model", "<inline>")
        self.assertEqual(findings, [])

    def test_contract_is_registered(self):
        self.assertIn("qa-report-model", vc.ContractValidator().list_contracts())


@unittest.skipUnless(os.path.exists(SAMPLE_MODEL), "Sample report model not present")
class SampleModelContractTest(unittest.TestCase):
    def setUp(self):
        self.validator = vc.ContractValidator()
        with open(SAMPLE_MODEL, encoding="utf-8") as fh:
            self.model = json.load(fh)

    def test_detected_as_report_model_without_warning(self):
        result = self.validator.validate_artifact(SAMPLE_MODEL)
        self.assertEqual(result.contract, "qa-report-model")
        self.assertTrue(result.valid, [f.to_dict() for f in result.errors])
        self.assertEqual(result.warnings, [])

    def test_metrics_match_source_data(self):
        metrics = rr.derive_metrics(self.model)
        self.assertEqual(metrics["counts"]["PASS"], 1)
        self.assertEqual(metrics["counts"]["FAIL"], 0)
        self.assertEqual(metrics["counts"]["BLOCKED"], 0)
        self.assertEqual(metrics["not_verified"], 0)
        self.assertEqual(metrics["confirmed_bugs"], 0)
        self.assertEqual(metrics["max_risk"], "LOW")
        self.assertEqual(metrics["reviewer"], "ACCEPT")


class DerivedMetricsTest(unittest.TestCase):
    def setUp(self):
        self.model = sample_model()
        self.metrics = rr.derive_metrics(self.model)

    def test_counts_come_from_results(self):
        self.assertEqual(self.metrics["counts"]["PASS"], 1)
        self.assertEqual(self.metrics["counts"]["FAIL"], 1)
        self.assertEqual(self.metrics["counts"]["BLOCKED"], 0)
        self.assertEqual(self.metrics["counts"]["NOT VERIFIED"], 1)

    def test_not_verified_includes_rows_and_list(self):
        self.assertEqual(
            self.metrics["not_verified"],
            self.metrics["counts"]["NOT VERIFIED"] + len(self.model["not_verified"]),
        )

    def test_confirmed_bugs_and_max_risk_are_derived(self):
        self.assertEqual(self.metrics["confirmed_bugs"], len(self.model["bugs"]["confirmed"]))
        self.assertEqual(self.metrics["max_risk"], "MEDIUM")
        self.assertEqual(self.metrics["reviewer"], "BLOCKED")


class HtmlRenderTest(unittest.TestCase):
    def _render(self, model):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "report.html")
            return rr.render(model, out, REPO_ROOT)

    def test_labels_are_in_user_language(self):
        html = self._render(sample_model())
        self.assertIn('lang="es"', html)
        self.assertIn("Resumen ejecutivo", html)
        self.assertIn("Alcance", html)
        self.assertIn("Resultados por caso", html)
        self.assertIn("Clasificación de fallos", html)
        self.assertIn("Riesgos", html)
        self.assertIn("Sin verificar", html)
        self.assertIn("Conclusión", html)
        self.assertNotIn("lenguaje claro", html)

    def test_optional_sections_render_only_with_data(self):
        model = sample_model()
        html = self._render(model)
        self.assertNotIn("Datos de prueba", html)
        self.assertNotIn("Retest / Regresión", html)

        model["test_data"] = [
            {"id": "TD-1", "description": "d", "state": "MISSING", "usable": False, "blocked_tests": ["TC-2"]}
        ]
        model["retest"] = [
            {"id": "RT-1", "related_bug_id": "BUG-1", "related_test_case_id": "TC-2", "result": "PASS", "fix_status": "FIXED"},
        ]
        html = self._render(model)
        self.assertIn("Datos de prueba", html)
        self.assertIn("Retest / Regresión", html)

    def test_source_artifacts_are_shown(self):
        self.assertIn("Artefactos de origen", self._render(sample_model()))

    def test_blank_optional_section_is_not_rendered(self):
        model = sample_model()
        del model["preflight"]
        html = self._render(model)
        self.assertNotIn("Pre-flight", html)


class SummaryTest(unittest.TestCase):
    def setUp(self):
        self.model = sample_model()
        self.metrics = rr.derive_metrics(self.model)
        self.text = rr.render_text_summary(self.model, self.metrics)

    def test_summary_is_derived_from_metrics(self):
        self.assertIn("PASS 1", self.text)
        self.assertIn("FAIL 1", self.text)
        self.assertIn("NOT VERIFIED 3", self.text)
        self.assertIn("Bugs confirmados: 1", self.text)
        self.assertIn("Riesgo máximo: MEDIUM", self.text)
        self.assertIn("QA Reviewer: BLOCKED", self.text)

    def test_summary_reuses_the_model_summary(self):
        for value in ("T", "W", "P", "U"):
            self.assertIn(value, self.text)
        self.assertIn("Alcance probado", self.text)

    def test_summary_changes_when_the_model_changes(self):
        mutated = sample_model()
        mutated["results"][0]["status"] = "FAIL"
        mutated["results"][0]["classification"] = "TEST_INFRASTRUCTURE"
        mutated["bugs"]["confirmed"] = []
        metrics = rr.derive_metrics(mutated)
        self.assertEqual(metrics["counts"]["PASS"], 0)
        self.assertEqual(metrics["counts"]["FAIL"], 2)
        self.assertEqual(metrics["confirmed_bugs"], 0)
        self.assertIn("PASS 0", rr.render_text_summary(mutated, metrics))


if __name__ == "__main__":
    unittest.main()
