# Arquitectura objetivo de automatización

| Campo | Valor |
| --- | --- |
| Fecha | 2026-10-09 |
| Estado | **M-03 IMPLEMENTADO** (runner reutilizable Web+API con Playwright Test, sin tokens) + **M-04 IMPLEMENTADO** (pre-flight ejecutable) + **M-05 IMPLEMENTADO** (auto-healing con guardrails) + **M-02 IMPLEMENTADO** (reportes `report.json`/`report.html` por corrida) + **M-06 IMPLEMENTADO** (verificación de datos SQLite read-only). Ver `docs/RUNNER-M03.md` (M-02), `docs/AUTO-HEALING.md` (M-05) y `docs/DATA-VERIFICATION.md` (M-06). |
| Principio rector | El **QA Core** decide y valida; los **adapters** ejecutan y capturan. Nunca al revés. |

> Este documento describe cómo se relacionan las piezas actuales y las futuras.
> Amplía el diagrama de capas de la arquitectura objetivo del sistema.

## 1. Vista general

```
┌──────────────────────────────────────────────────────────────────────┐
│ QA CORE (decisión, evidencia, contratos) — sin cambiar                │
│  qa-lead · test-designer · risk-analyst · test-data · exploratory-qa   │
│  bug-analyst · qa-reviewer                                             │
└───────────────┬──────────────────────────────────────────────────────┘
                │ delega / consume
     ┌──────────┴───────────┐
     │ test-executor (gate) │  ← Pre-flight (M-04, contrato en
     └───────┬──────────────┘     docs/PRE-FLIGHT-CAPABILITIES.md)
             │ READY ⇒ ejecuta
   ┌─────────┴───────────────────────────────────────────┐
   │ ADAPTERS (decoupled)                                 │
   │  · Playwright Web/API  (base en automation/)  [M-03] │
   │  · api-testing skill   (API/HTTP)                    │
   │  · DB read-only        [M-06, implementado]          │
   └─────────┬───────────────────────────────────────────┘
             │ produce
   ┌─────────┴───────────────┐     ┌───────────────────────────────┐
   │ EVIDENCE + ARTEFACTOS   │────▶│ M-01 validador de contratos    │
   │ qa/evidence · qa/*.json │     │ (Python stdlib, self-check D1) │
   └─────────────────────────┘     └───────────────────────────────┘
                                                │
                          M-02 reportes JSON/HTML (implementado, por corrida) → FAST/DETAIL
```

## 2. Responsabilidades por componente

### QA Core y Agents
Deciden, clasifican fallos, exigen evidencia y validan. **No** dependen de que
exista automatización instalada: si el adapter no está disponible, el Core sigue
operando de forma manual o marca `BLOCKED`.

### Python — validador de contratos (M-01)
Único responsable de validar artefactos JSON contra `qa/schema/`. Se mantiene en
**Python 3 stdlib**, sin dependencias. **No se migra ni se duplica en Node.js.**
Es un gate read-only: nunca transforma resultados (FAIL sigue FAIL, un Bug no se
promueve, un veredicto no se vuelve `ACCEPT`).

### Node.js — runner reutilizable (M-03, implementado)
Runtime del runner. Ejecuta pruebas **sin tokens** y produce resultados/evidencia
determinísticos. Fuente en `automation/runner/` (TS → `automation/.dist`),
manifestos en `automation/manifests/`, docs en `docs/RUNNER-M03.md`.

### Playwright — Web/API (M-03)
Primera opción para Web y API. El fixture `request` cubre API/HTTP sin agregar
Axios/Newman. Los navegadores se instalan bajo demanda; solo Chromium integra la
base inicial.

### Evidence y artefactos JSON
- **Evidencia** (screenshots, traces, videos, logs) → `qa/evidence/`.
- **Artefactos estructurados** → `qa/**/*.json`, validados por M-01.
- La salida interna de Playwright (`automation/.artifacts/`) **no** es evidencia
  QA: se ignora y se promueve a `qa/evidence/` solo lo que el runner decide
  registrar, siguiendo los contratos.

### Pre-flight y detección de capacidades (M-04, implementado)
Gate previo a ejecutar. Detector ejecutable `qa/tools/preflight.py`; define
`READY`/`BLOCKED` y sus causas (`docs/PRE-FLIGHT-CAPABILITIES.md`). El runner
(M-03) lo invoca antes de cada corrida y registra `preflight_record.json`.
`test-executor`/runner no ejecutan sin `READY`.

### Auto-healing con guardrails (M-05, implementado)
Construido **sobre** el runner (M-03). El motor (`automation/runner/healed.ts`)
es parte del adapter Playwright: intenta el locator original y, si no resuelve,
genera y evalúa candidatos en orden de prioridad con criterios estrictos
(unicidad, visibilidad, identidad funcional y estado). Solo sustituye el
locator; **nunca** cambia Expected Results, **nunca** convierte FAIL en PASS y
**nunca** clasifica un Bug. Cada intento se registra como `auto-heal-record`
(M-01) con `heal_id` único; el runner enriquece los traces con un bloque
`auto_healing`. Ver `docs/AUTO-HEALING.md`.

## 3. Fronteras de acoplamiento (reglas)

1. **Core ⇄ Adapter:** el Core no importa código del adapter; se comunican por
   **artefactos JSON** validados. El adapter no decide PASS/FAIL "de negocio".
2. **Python ⇄ Node:** sin duplicación. Python valida; Node ejecuta. Ninguno
   reimplementa la lógica del otro.
3. **`qa/` ⇄ `automation/`:** `automation/` está **fuera** de `qa/` para no
   contaminar el descubrimiento de artefactos del validador (`--bundle qa`).
4. **Opcionalidad:** cada capacidad declara su dependencia; si falta, `BLOCKED`.
   El Core funciona con la carpeta de automatización vacía.
5. **Least privilege / read-only por defecto.**

## 4. Flujo de una corrida (M-03 + M-04)

1. Objetivo y Scope → riesgo (risk-analyst) → Test Cases.
2. El runner carga el **manifiesto de suite** (`automation/manifests/`), selecciona
   TCs (todos o `--tc`) y verifica que los specs existan.
3. (Opcional) levanta el `web_server` local declarado.
4. **Pre-flight** detecta capacidades → `READY` o `BLOCKED`. Si `BLOCKED`, se
   registran traces `BLOCKED` con causas y **no** se inicia Playwright (exit 3).
5. Si `READY`, el runner ejecuta las specs seleccionadas **sin tokens** y genera
   `execution_trace.json` + `preflight_record.json` + evidence por TC.
6. El resultado se **valida con M-01** (`--bundle <out>`) antes de aceptarlo.
7. bug-analyst clasifica los FAIL; qa-reviewer audita; se genera el reporte
   (M-02, implementado).
8. Si hubo auto-healing (M-05), cada intento queda en `autoheal_record.json` y en
   el bloque `auto_healing` del trace. La recuperación solo selecciona el
   locator: el status sigue siendo el que producen las aserciones (un FAIL se
   conserva) y la decisión de aceptar un cambio permanente exige regresión.

## 5. Estado actual vs. objetivo

| Pieza | Estado |
| --- | --- |
| QA Core + contratos + validador M-01 | **Implementado y verificado** (38 tests, bundle `qa` VALID) |
| Runner ligado a Test Cases (M-03) | **Implementado y verificado** (runner TS + tests infra; corridas web/API reales) |
| Pre-flight ejecutable (M-04) | **Implementado y verificado** (48 tests; gate del runner) |
| Base de automatización (Node 24 + Playwright) | **Preparada y verificada** (prueba de infraestructura `PASS`) |
| Reportes JSON/HTML propios (M-02) | **Implementado y verificado** (`report.json` + `report.html` por corrida; contrato `execution-report`) |
| Auto-healing con guardrails (M-05) | **Implementado y verificado** (motor + contrato `auto-heal-record` + **12 Test Cases** demo + la verificación de infraestructura `TC-HEAL-12` + pre-flight) |
| BD read-only (M-06) | **Implementado y verificado** (solo SQLite, `node:sqlite` en modo read-only, una sola sentencia SELECT/WITH; contrato `data-verification`) |

## 6. Limitaciones y supuestos pendientes

- El runner ejecuta las suites **demo aisladas** (app local `demo-qaa`) y las
  suites demo de auto-healing (app local `127.0.0.1:4174`). De los 11 TC de
  negocio dcshoes, **TC-001 ya está portado** (`SUITE-dcshoes-tc001` /
  `automation/specs/dcshoes/home.spec.ts`, solo navegación/lectura); los 10
  restantes aún no se portan (validación de aplicación real, próxima etapa). Las
  suites automatizadas se asocian vía manifiesto (`test_case_id` ↔ spec).
- Node v24.21.0 (canal oficial nodejs.org, per-user, sin privilegios). El PATH
  de usuario se actualizó; las sesiones ya abiertas deben reiniciarse para
  heredarlo. En PowerShell se usa `npm.cmd` si la política de ejecución bloquea
  `npm.ps1`.
- Solo Chromium está instalado. Firefox/WebKit quedan bajo demanda.
- El auto-healing permanece **desactivado por defecto** (`mode: OFF`) y es
  **opcional por objetivo**; se valida en demos aisladas antes de cualquier uso
  sobre una aplicación real.
