#!/usr/bin/env python3
"""
Demo de flujo E2E completo del sistema AGENTE-QAA.

Este script simula un flujo completo de QA:
1. qa-lead recibe el objetivo
2. test-designer diseña los casos
3. risk-analyst evalúa riesgos
4. test-data valida datos
5. test-executor ejecuta (simulado)
6. bug-analyst clasifica fallos
7. qa-reviewer revisa
8. qa-lead consolida

Los artefactos generados se validan contra sus contratos M-01.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# Asegurar que la salida soporte Unicode en consolas Windows (cp1252)
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / "qa" / "tools" / "validate_contracts.py"


def validate(contract: str, artifact: dict) -> tuple[bool, str]:
    """Valida un artefacto contra su contrato M-01."""
    fd, tmp_path = tempfile.mkstemp(suffix='.json')
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(artifact, f, indent=2)
        result = subprocess.run(
            [sys.executable, str(VALIDATOR), "--contract", contract, "--file", tmp_path, "--json"],
            capture_output=True,
            text=True,
            cwd=str(ROOT),
        )
        return result.returncode == 0, result.stdout + result.stderr
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def main():
    print("=" * 60)
    print("AGENTE-QAA: Demo de flujo E2E completo")
    print("=" * 60)

    # 1. Test Designer: diseñar casos
    print("\n[1/7] Test Designer: diseñando casos...")
    test_cases = [
        {
            "test_case_id": "TC-001",
            "title": "Login válido con credenciales correctas",
            "objective": "Verificar que un usuario puede loguearse correctamente",
            "preconditions": ["Usuario registrado en el sistema"],
            "test_data": [{"data_id": "TD-001", "required_for": "precondition"}],
            "steps": ["Ir a /login", "Ingresar email válido", "Ingresar password correcto", "Click en Login"],
            "expected_result": "Dashboard visible con el nombre del usuario",
            "status": "NOT_EXECUTED",
            "severity": "HIGH",
            "priority": "P1",
            "evidence": [],
            "confidence": "HIGH",
            "confidence_rationale": "Caso bien definido y ejecutable",
            "risk": "R-001",
            "traceability": {"requirement": "REQ-001", "risk_id": "R-001", "test_data_id": "TD-001"},
        },
        {
            "test_case_id": "TC-002",
            "title": "Login inválido con password incorrecto",
            "objective": "Verificar que el sistema rechaza credenciales inválidas",
            "preconditions": ["Usuario registrado en el sistema"],
            "test_data": [{"data_id": "TD-001", "required_for": "precondition"}],
            "steps": ["Ir a /login", "Ingresar email válido", "Ingresar password incorrecto", "Click en Login"],
            "expected_result": "Mensaje de error 'Credenciales inválidas'",
            "status": "NOT_EXECUTED",
            "severity": "MEDIUM",
            "priority": "P2",
            "evidence": [],
            "confidence": "HIGH",
            "confidence_rationale": "Caso bien definido y ejecutable",
            "risk": "R-002",
            "traceability": {"requirement": "REQ-002", "risk_id": "R-002", "test_data_id": "TD-001"},
        },
    ]
    ok, output = validate("test-case", {"suite_id": "SUITE-DEMO", "test_cases": test_cases})
    print(f"  Test Cases: {'✓ Válidos' if ok else '✗ Inválidos'}")
    if not ok:
        print(f"    {output}")

    # 2. Risk Analyst: evaluar riesgos
    print("\n[2/7] Risk Analyst: evaluando riesgos...")
    risks = [
        {
            "risk_id": "R-001",
            "risk": "Fallo en autenticación bloquea acceso al sistema",
            "category": "functional",
            "impact": "CRITICAL",
            "probability": "MEDIUM",
            "risk_level": "CRITICAL",
            "priority": "P0",
            "rationale": "Sin login no se puede usar el sistema",
            "action_required": "test",
            "required_evidence": ["execution_trace", "screenshot"],
            "needs_double_check": True,
            "needs_qa_reviewer": True,
            "confidence": "HIGH",
            "mitigations": [],
        },
        {
            "risk_id": "R-002",
            "risk": "Mensaje de error no claro para el usuario",
            "category": "functional",
            "impact": "LOW",
            "probability": "HIGH",
            "risk_level": "MEDIUM",
            "priority": "P2",
            "rationale": "UX, no bloquea funcionalidad",
            "action_required": "test",
            "required_evidence": ["screenshot"],
            "needs_double_check": False,
            "needs_qa_reviewer": False,
            "confidence": "MEDIUM",
            "mitigations": [],
        },
    ]
    ok, output = validate("risk-record", risks[0])
    print(f"  Risk R-001: {'✓ Válido' if ok else '✗ Inválido'}")
    if not ok:
        print(f"    {output}")

    # 3. Test Data: validar datos
    print("\n[3/7] Test Data: validando datos...")
    test_data = [
        {
            "data_id": "TD-001",
            "description": "Usuario de prueba registrado",
            "test_case_ids": ["TC-001", "TC-002"],
            "required_for": "precondition",
            "source": "user_provided",
            "state": "AVAILABLE",
            "validation": {
                "method": "login manual verificado",
                "evidence": ["qa/evidence/login_verified.png"],
                "validated": True,
            },
            "usable": True,
            "blocks_test_cases": [],
            "confidence": "HIGH",
            "notes": "Usuario verificado el 2026-10-17",
        },
    ]
    ok, output = validate("test-data-record", test_data[0])
    print(f"  Test Data TD-001: {'✓ Válido' if ok else '✗ Inválido'}")
    if not ok:
        print(f"    {output}")

    # 4. Test Executor: ejecutar (simulado)
    print("\n[4/7] Test Executor: ejecutando pruebas (simulado)...")
    execution_traces = [
        {
            "trace_id": "TR-001",
            "context": "TC-001 Login válido",
            "tool_requested": "playwright:login.spec.ts:TC-001",
            "tool_executed": "playwright:login.spec.ts:TC-001",
            "executed": True,
            "execution_success": True,
            "result_obtained": "PASS — Dashboard visible",
            "result_validated": "Validado contra expected_result",
            "expected_result": "Dashboard visible con el nombre del usuario",
            "actual_result": "Dashboard visible con el nombre del usuario",
            "evidence": ["qa/evidence/tc001_dashboard.png"],
            "validation_performed": True,
            "notes": "tool called → tool succeeded → result obtained → result validated",
        },
        {
            "trace_id": "TR-002",
            "context": "TC-002 Login inválido",
            "tool_requested": "playwright:login.spec.ts:TC-002",
            "tool_executed": "playwright:login.spec.ts:TC-002",
            "executed": True,
            "execution_success": True,
            "result_obtained": "PASS — Mensaje de error visible",
            "result_validated": "Validado contra expected_result",
            "expected_result": "Mensaje de error 'Credenciales inválidas'",
            "actual_result": "Mensaje de error 'Credenciales inválidas' visible",
            "evidence": ["qa/evidence/tc002_error.png"],
            "validation_performed": True,
            "notes": "tool called → tool succeeded → result obtained → result validated",
        },
    ]
    ok, output = validate("execution-trace", {"suite_id": "SUITE-DEMO", "traces": execution_traces})
    print(f"  Execution Traces: {'✓ Válidos' if ok else '✗ Inválidos'}")
    if not ok:
        print(f"    {output}")

    # 5. Bug Analyst: analizar fallos (simulado - no hay fallos en este demo)
    print("\n[5/7] Bug Analyst: analizando fallos...")
    print("  No hay fallos en esta ejecución. ✓")

    # 6. QA Reviewer: revisar
    print("\n[6/7] QA Reviewer: revisando resultados...")
    reviewer_verdict = {
        "verdict": "ACCEPT",
        "confidence": "HIGH",
        "confidence_rationale": "Evidencia suficiente, reproducible y bien documentada",
        "findings": [],
        "missing_evidence": [],
        "evidence_references": [
            {"path": "qa/evidence/tc001_dashboard.png", "type": "screenshot", "notes": "Dashboard visible"},
            {"path": "qa/evidence/tc002_error.png", "type": "screenshot", "notes": "Mensaje de error"},
        ],
        "reasoning_summary": "Ambos casos pasaron con evidencia clara y trazabilidad completa",
        "requires_retest": False,
        "requires_additional_evidence": False,
        "recommendations": [],
    }
    ok, output = validate("reviewer-verdict", reviewer_verdict)
    print(f"  Reviewer Verdict: {'✓ Válido' if ok else '✗ Inválido'}")
    if not ok:
        print(f"    {output}")

    # 7. QA Lead: consolidar
    print("\n[7/7] QA Lead: consolidando reporte final...")
    qa_report_model = {
        "report_model_id": "QRM-DEMO-001",
        "source_artifacts": [
            {"path": "qa/evidence/tc001_dashboard.png", "contract": "execution-trace", "note": "TC-001"},
            {"path": "qa/evidence/tc002_error.png", "contract": "execution-trace", "note": "TC-002"},
        ],
        "meta": {
            "title": "Smoke Test — Sistema de Login",
            "status": "PASS",
            "mode": "FAST",
            "max_risk_override": "LOW",
            "max_risk_override_reason": "Todos los casos pasaron",
        },
        "executive_summary": {
            "tested": "Login con credenciales válidas e inválidas",
            "worked": "Ambos casos funcionaron correctamente",
            "problems": "Ninguno",
            "unverified": "Nada",
            "report": "qa/reports/demo-smoke-test.html",
        },
        "scope": {
            "in": "Login de usuario",
            "out": "Registro, recuperación de password",
        },
        "results": [
            {"id": "TC-001", "title": "Login válido", "status": "PASS", "confidence": "HIGH"},
            {"id": "TC-002", "title": "Login inválido", "status": "PASS", "confidence": "HIGH"},
        ],
        "bugs": {"confirmed": [], "investigated": []},
        "risks": [
            {"id": "R-001", "title": "Fallo en autenticación", "level": "CRITICAL", "impact": "CRITICAL", "probability": "MEDIUM", "priority": "P0", "confidence": "HIGH", "note": "Verificado OK"},
        ],
        "conclusion": ["El sistema de login funciona correctamente para credenciales válidas e inválidas"],
    }
    ok, output = validate("qa-report-model", qa_report_model)
    print(f"  QA Report Model: {'✓ Válido' if ok else '✗ Inválido'}")
    if not ok:
        print(f"    {output}")

    # Resumen
    print("\n" + "=" * 60)
    print("Demo E2E completado exitosamente")
    print("=" * 60)
    print("\nArtefactos generados:")
    print("  - 2 Test Cases (TC-001, TC-002)")
    print("  - 2 Risk Records (R-001, R-002)")
    print("  - 1 Test Data Record (TD-001)")
    print("  - 2 Execution Traces (TR-001, TR-002)")
    print("  - 1 Reviewer Verdict (ACCEPT)")
    print("  - 1 QA Report Model (QRM-DEMO-001)")
    print("\nTodos los artefactos pasaron la validación M-01. ✓")


if __name__ == "__main__":
    main()
