#!/usr/bin/env python3
"""
Tests de integración del flujo multiagente.

Verifica que los artefactos generados por cada agente pasen la validación M-01
y que el flujo completo (lead → designer → executor → bug-analyst → reviewer)
produzca artefactos válidos.
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / "qa" / "tools" / "validate_contracts.py"


def run_validator(contract: str, file: Path) -> tuple[bool, str]:
    """Ejecuta el validador M-01 y retorna (ok, output)."""
    result = subprocess.run(
        [sys.executable, str(VALIDATOR), "--contract", contract, "--file", str(file), "--json"],
        capture_output=True,
        text=True,
        cwd=str(ROOT),
    )
    return result.returncode == 0, result.stdout + result.stderr


class TestMultiagentFlow(unittest.TestCase):
    """Tests de integración del flujo completo de agentes."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_test_case_contract(self):
        """Un Test Case válido pasa la validación."""
        tc = {
            "test_case_id": "TC-001",
            "title": "Login válido",
            "objective": "Verificar login con credenciales correctas",
            "preconditions": ["Usuario registrado"],
            "test_data": [],
            "steps": ["Ingresar email", "Ingresar password", "Click login"],
            "expected_result": "Dashboard visible",
            "status": "NOT_EXECUTED",
            "severity": "HIGH",
            "priority": "P1",
            "evidence": [],
            "confidence": "HIGH",
            "confidence_rationale": "Caso bien definido",
            "risk": "R-001",
            "traceability": {"requirement": "REQ-001", "risk_id": "R-001", "test_data_id": ""},
        }
        wrapper = {"suite_id": "SUITE-TEST", "test_cases": [tc]}
        path = self.tmp_path / "tc.json"
        path.write_text(json.dumps(wrapper, indent=2))
        ok, output = run_validator("test-case", path)
        self.assertTrue(ok, f"Test Case inválido: {output}")

    def test_test_result_pass_contract(self):
        """Un Test Result PASS válido pasa la validación."""
        result = {
            "test_id": "TC-001",
            "status": "PASS",
            "expected_result": "Dashboard visible",
            "actual_result": "Dashboard visible",
            "expected": "Dashboard visible",
            "observed": "Dashboard visible",
            "evidence": ["qa/evidence/screenshot.png"],
            "confidence": "HIGH",
            "confidence_rationale": "Resultado claro y reproducible",
        }
        path = self.tmp_path / "result.json"
        path.write_text(json.dumps(result, indent=2))
        ok, output = run_validator("test-result", path)
        self.assertTrue(ok, f"Test Result inválido: {output}")

    def test_test_result_fail_requires_classification(self):
        """Un Test Result FAIL sin classification es inválido."""
        result = {
            "test_id": "TC-001",
            "status": "FAIL",
            "expected_result": "Dashboard visible",
            "actual_result": "Error 500",
            "expected": "Dashboard visible",
            "observed": "Error 500",
            "evidence": ["qa/evidence/error.png"],
            "confidence": "MEDIUM",
        }
        path = self.tmp_path / "result.json"
        path.write_text(json.dumps(result, indent=2))
        ok, output = run_validator("test-result", path)
        self.assertFalse(ok, "FAIL sin classification debería ser inválido")

    def test_failure_classification_contract(self):
        """Una Failure Classification válida pasa la validación."""
        fc = {
            "classification_id": "FC-001",
            "test_id": "TC-001",
            "result_status": "FAIL",
            "failure_classification": "TEST_DATA",
            "analysis_inputs": {
                "expected_result": "Dashboard visible",
                "actual_result": "Login error",
                "evidence": ["qa/evidence/login.png"],
                "execution_traceability": "TR-001",
                "test_data": [],
                "context": "Usuario expirado",
                "memory_considered": [],
            },
            "outcome": "CAUSE_IDENTIFIED",
            "related_bug_id": "",
            "rationale": "El usuario estaba expirado",
            "confidence": "HIGH",
            "confidence_rationale": "Evidencia clara de expiración",
        }
        path = self.tmp_path / "fc.json"
        path.write_text(json.dumps(fc, indent=2))
        ok, output = run_validator("failure-classification", path)
        self.assertTrue(ok, f"Failure Classification inválida: {output}")

    def test_bug_record_contract(self):
        """Un Bug Record válido pasa la validación."""
        bug = {
            "bug_id": "BUG-001",
            "title": "Login falla con usuario válido",
            "related_test_case_id": "TC-001",
            "failure_classification": "APP_BUG",
            "severity": "HIGH",
            "priority": "P1",
            "status": "CONFIRMED",
            "environment": {"browser": "chromium", "os": "linux"},
            "preconditions": ["Usuario registrado"],
            "steps_to_reproduce": ["Ir a login", "Ingresar credenciales", "Click login"],
            "expected": "Dashboard visible",
            "observed": "Error 500",
            "evidence": ["qa/evidence/error.png", "qa/evidence/trace.zip"],
            "possible_cause": "El servidor no maneja bien la autenticación",
            "confidence": "HIGH",
        }
        path = self.tmp_path / "bug.json"
        path.write_text(json.dumps(bug, indent=2))
        ok, output = run_validator("bug-record", path)
        self.assertTrue(ok, f"Bug Record inválido: {output}")

    def test_reviewer_verdict_contract(self):
        """Un Reviewer Verdict válido pasa la validación."""
        verdict = {
            "verdict": "ACCEPT",
            "confidence": "HIGH",
            "confidence_rationale": "Evidencia suficiente y reproducible",
            "findings": [],
            "missing_evidence": [],
            "evidence_references": [{"path": "qa/evidence/error.png", "type": "screenshot", "notes": ""}],
            "reasoning_summary": "El bug está bien documentado y es reproducible",
            "requires_retest": False,
            "requires_additional_evidence": False,
            "recommendations": [],
        }
        path = self.tmp_path / "verdict.json"
        path.write_text(json.dumps(verdict, indent=2))
        ok, output = run_validator("reviewer-verdict", path)
        self.assertTrue(ok, f"Reviewer Verdict inválido: {output}")

    def test_execution_trace_contract(self):
        """Un Execution Trace válido en su wrapper de suite pasa la validación."""
        trace = {
            "trace_id": "TR-001",
            "context": "TC-001 Login válido",
            "tool_requested": "playwright:login.spec.ts",
            "tool_executed": "playwright:login.spec.ts",
            "executed": True,
            "execution_success": True,
            "result_obtained": "PASS — login exitoso",
            "result_validated": "Validado contra expected_result",
            "expected_result": "Dashboard visible",
            "actual_result": "Dashboard visible",
            "evidence": ["qa/evidence/login.png"],
            "validation_performed": True,
            "notes": "tool called → tool succeeded → result obtained → result validated",
        }
        wrapper = {"suite_id": "SUITE-TEST", "traces": [trace]}
        path = self.tmp_path / "trace.json"
        path.write_text(json.dumps(wrapper, indent=2))
        ok, output = run_validator("execution-trace", path)
        self.assertTrue(ok, f"Execution Trace inválido: {output}")

    def test_preflight_record_contract(self):
        """Un Pre-flight Record válido pasa la validación."""
        record = {
            "preflight_id": "PF-001",
            "scope": "suite demo-web",
            "checks": [
                {"check": "target_accessible", "status": "OK", "evidence": [], "notes": ""},
                {"check": "tools_available", "status": "OK", "evidence": [], "notes": ""},
            ],
            "result": "READY",
            "blocked_reasons": [],
            "confidence": "HIGH",
            "notes": "Todo listo para ejecutar",
        }
        path = self.tmp_path / "preflight.json"
        path.write_text(json.dumps(record, indent=2))
        ok, output = run_validator("pre-flight-record", path)
        self.assertTrue(ok, f"Pre-flight Record inválido: {output}")

    def test_test_data_record_contract(self):
        """Un Test Data Record válido pasa la validación."""
        record = {
            "data_id": "TD-001",
            "description": "Usuario de prueba",
            "test_case_ids": ["TC-001"],
            "required_for": "precondition",
            "source": "user_provided",
            "state": "AVAILABLE",
            "validation": {"method": "login manual", "evidence": ["qa/evidence/login.png"], "validated": True},
            "usable": True,
            "blocks_test_cases": [],
            "confidence": "HIGH",
            "notes": "Usuario verificado",
        }
        path = self.tmp_path / "td.json"
        path.write_text(json.dumps(record, indent=2))
        ok, output = run_validator("test-data-record", path)
        self.assertTrue(ok, f"Test Data Record inválido: {output}")

    def test_qa_report_model_contract(self):
        """Un QA Report Model válido pasa la validación."""
        model = {
            "report_model_id": "QRM-001",
            "source_artifacts": [{"path": "automation/.runs/demo/result.json", "contract": "test-result", "note": ""}],
            "meta": {
                "title": "Smoke Test — demo",
                "status": "PASS",
                "mode": "FAST",
                "max_risk_override": "LOW",
                "max_risk_override_reason": "",
            },
            "executive_summary": {"tested": "Login", "worked": "Todo", "problems": "Nada", "unverified": "Nada", "report": ""},
            "scope": {"in": "Login", "out": "Registro"},
            "results": [{"id": "TC-001", "title": "Login", "status": "PASS", "confidence": "HIGH"}],
            "bugs": {"confirmed": [], "investigated": []},
            "risks": [],
            "conclusion": ["Todo OK"],
        }
        path = self.tmp_path / "model.json"
        path.write_text(json.dumps(model, indent=2))
        ok, output = run_validator("qa-report-model", path)
        self.assertTrue(ok, f"QA Report Model inválido: {output}")


if __name__ == "__main__":
    unittest.main()
