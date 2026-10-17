# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/),
y este proyecto se adhiere a [Semantic Versioning](https://semver.org/lang/es/).

## [0.1.0] - 2026-10-17

### Agregado
- Sistema multiagente de 8 agentes: `qa-lead`, `test-designer`, `risk-analyst`, `exploratory-qa`, `test-data`, `test-executor`, `bug-analyst`, `qa-reviewer`.
- M-01: Validación de contratos con JSON Schema (Python 3 stdlib) — 39 tests.
- M-02: Reportes de ejecución `report.json` + `report.html`.
- M-03: Runner reusable (Playwright Test, Web + API) — 32 tests.
- M-04: Pre-flight ejecutable — 48 tests.
- M-05: Auto-healing con guardrails (`OFF` / `OBSERVE` / `HIGH_CONFIDENCE`).
- M-06: Verificación de datos SQLite de solo lectura — 25 tests.
- 11 skills reutilizables en `.opencode/skills/` (incluye `error-handling`).
- 13 documentos de contratos, arquitectura y políticas en `docs/`.
- Health check script (`automation/scripts/health-check.mjs`).
- Tests de integración multiagente (`tests/integration/`).

### Corregido
- Migración de `opencode.json` de formato V1 a V2.
- Migración de los 8 agentes de formato V1 a V2 (permisos, campos).
- Modelos actualizados a IDs disponibles en el entorno.

### Conocido
- Las plataformas Hybrid y Native están planificadas, no implementadas.
- La calidad de los modelos LLM no está validada.
- No incluye CI/CD ni aplicación de producto publicada.
