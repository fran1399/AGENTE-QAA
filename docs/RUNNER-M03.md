# Runner de automatización reutilizable (M-03)

| Campo | Valor |
| --- | --- |
| Estado | **IMPLEMENTADO (2026-10-09)** |
| Motor | **Playwright Test** (Web + API), sin Axios/Newman en esta etapa |
| Base | Node.js 24.x + TypeScript (`automation/`) |
| Evidencia | Corridas reales (abajo) + `automation/tests/runner.infra.spec.ts` (33 tests: M-03, M-05, M-02 —incl. JUnit— y M-06) + `automation/tests/junit.spec.ts` (8 tests del exportador) + `automation/tests/sqlite-adapter.spec.ts` (25 tests M-06) |
| Validación | M-01 (`qa/tools/validate_contracts.py`) y M-04 (`qa/tools/preflight.py`) intactos y usados |
| Reportes | **M-02**: `report.json` + `report.html` por corrida (contrato `execution-report`) + JUnit XML opcional (`--junit`, §5.1) |
| Datos | **M-06**: verificaciones SQLite de solo lectura (`data_verification.json`, contrato `data-verification`) |

## 1. Propósito

Ejecutar **Test Cases persistidos** como automatización reproducible, **sin IA por
paso** (sin tokens en la corrida) y con resultados estructurados trazables,
validables por **M-01**. El runner **no decide** si un FAIL confirma un Bug
(eso lo hace Bug Analyst) y **no** clasifica. Desde M-05 el runner integra
auto-healing con guardrails (modos `OFF`/`OBSERVE`/`HIGH_CONFIDENCE`), que solo
selecciona locators y conserva el resultado real (ver `docs/AUTO-HEALING.md`).

Principios aplicados:

- `tool called` → `tool succeeded` → `result obtained` → `result validated` se
  distinguen explícitamente en cada trace.
- FAIL = FAIL: el runner **nunca clasifica** (sin `failure_classification`);
  deja `notes` con "classification pending (Bug Analyst)".
- Pre-flight (M-04) es gate obligatorio antes de ejecutar; si no hay `READY`,
  la corrida registra traces `BLOCKED` con causas (`executed: false`).
- Evidencia por app/corrida/TC; **nunca** se exponen credenciales en logs,
  manifest ni resultados.
- Solo fixtures y servidores locales en las pruebas: no hay simulaciones de
  ejecuciones exitosas.

## 2. Arquitectura

```
MANIFESTO DE SUITE (JSON)              SPECS PLAYWRIGHT (TS)
 automation/manifests/<suite_id>.json   automation/specs/<app>/<file>.spec.ts
        │  suite_id + test_cases[]               │  test() ↔ test_name del manifest
        │  (test_case_id, title, spec,           │
        │   test_name, expected_result)          ▼
        ▼                                ┌─────────────────────────────┐
 RUNNER (CLI, automation/.dist/runner)   │ testdir = <root>/automation  │
  1. load + valida manifest ────────────▶│ JSON reporter → results.raw  │
  2. selección de TCs (todos o --tc)     └──────────────┬──────────────┘
  3. verifica specs existen                             │ mapea por test_case_id
  4. (opcional) web_server local  ◀─ inicia antes del pre-flight
  5. PRE-FLIGHT (M-04) → READY | BLOCKED
  6. Playwright (specs seleccionados)
  7. mapea resultados crudos → traces; promueve evidence
  8. escribe execution_trace.json + preflight_record.json + summary.json
        │
        ▼
 M-01 (qa/tools/validate_contracts.py --bundle <out>) → artefacto válido
```

El runner spawns:

- **Pre-flight**: `python qa/tools/preflight.py --requirements <r> --out <pf>` con
  requirements construidos desde el manifest (runtime, adapters, browsers,
  herramientas, target, credenciales, evidence-dir, QA Reviewer). La señal
  declarativa `QAA_QA_REVIEWER_AVAILABLE` se registra tal cual (M-04 la marca
  `availability_source: declarative_signal`); el runner nunca la presenta como
  sondéo real.
- **Playwright**: `process.execPath node_modules/playwright/cli.js test --config
  automation/runner/config.ts <filters>` (filters = rutas repo-relativas de los
  specs seleccionados; cwd = raíz del repo; `QAA_TARGET_URL` se inyecta en el
  entorno de los specs — nunca se hardcodea el target).

## 3. Manifiesto de suite

`automation/manifests/<suite_id>.json` (la asociación `test_case_id` ↔ archivo
automatizado vive aquí):

```jsonc
{
  "suite_id": "SUITE-demo-qaa-web",
  "app": "demo-qaa",
  "platform": "web",                 // web | api
  "adapter": "playwright",
  "web_server": {                    // opcional: servidor local aislado
    "command": "node automation/scripts/serve-demo.mjs",
    "url": "http://127.0.0.1:4173/",
    "timeout_ms": 15000
  },
  "requirements": {                  // bloque "need" del pre-flight M-04
    "task": "SUITE-demo-qaa-web",
    "scope": "…",
    "platform": "web",
    "need": {
      "runtime": { "python": true, "node": true, "npm": true },
      "node_packages": ["@playwright/test"],
      "adapters": ["playwright"],
      "browsers": ["chromium"],      // [] para suites API-only
      "tools": ["node", "npm"],
      "target": { "url": "http://127.0.0.1:4173/", "method": "GET", "ok_status_max": 499, "timeout_ms": 5000 },
      "requires_evidence": true,
      "qa_reviewer": { "required": false }
    }
  },
  "test_cases": [
    {
      "test_case_id": "TC-DEMO-WEB-1",
      "title": "Home renders the product catalog",
      "spec": "automation/specs/demo-web/site.spec.ts",
      "test_name": "home renders the product catalog",   // = test('...') en el spec
      "expected_result": "…"
    }
  ]
}
```

Reglas:

- `test_name` debe coincidir **exactamente** con el `test('…')` del spec.
- Un manifest infringe la estructura → exit 2 con la causa.
- El runner sobrescribe `evidence_dir` y `requires_evidence` en el `need`
  (apunta al directorio de evidencia de la corrida).
- Los manifiestos demo e infra-temp se validan estructuralmente por el runner
  (TS); **no** se agregan esquemas al registro M-01 (`qa/schema/index.json`).
- Suite/target/credenciales por entorno: `QAA_TARGET_URL` lo setea el runner;
  credenciales solo desde variables del proceso (nunca en el manifest).

## 4. Comandos

```bash
npm run build:runner                 # tsc -p automation/runner/tsconfig.json → automation/.dist
npm test                             # pretest build + 68 tests (2 smoke + 33 runner.infra + 8 junit + 25 sqlite-adapter)
npm run suite -- --suite SUITE-demo-qaa-web            # out por defecto: automation/.runs/<suite>/<run>
npm run suite -- --suite SUITE-demo-qaa-api
npm run suite -- --suite SUITE-demo-qaa-web --tc TC-DEMO-WEB-1   # selección
npm run suite -- --manifest <path> --suite <id>       # manifiesto explícito (temp en tests)
npm run suite:demo-web              # con out fijo: automation/.runs/suite-demo-web
npm run suite:demo-api
npm run suite -- --suite SUITE-demo-qaa-web --junit   # + <out>/junit.xml (opt-in)
```

CLI del runner (`node automation/.dist/runner/runner.js`):

| Flag | Descripción |
| --- | --- |
| `--suite <suite_id>` | Suite del registro `automation/manifests/<suite_id>.json` |
| `--manifest <path>` | Manifiesto explícito (prima sobre `--suite`) |
| `--tc <id> [<id>…]` | Selección de Test Cases específicos (default: todos) |
| `--out <dir>` | Directorio de corrida (default: `automation/.runs/<suite_id>/<run_id>`, **fuera de `qa/`** para no alterar el bundle canónico M-01) |
| `--no-preflight` | **debug only**: omite el gate (nunca para corridas QA) |
| `--python <exe>` | Intérprete Python del pre-flight (default: `python`) |
| `--junit [path]` | Exporta además JUnit XML (default: `<out>/junit.xml`). Opt-in; no altera `report.json`/`report.html`. |

### Códigos de salida

| Código | Significado |
| --- | --- |
| `0` | Todos los TCs ejecutados con PASS |
| `1` | Algún FAIL/SKIPPED (**FAIL queda sin clasificar**; ver trace) **o** un fallo de Playwright no explicado por ningún resultado mapeado |
| `2` | Usage/fatal: suite no existe, manifest inválido, spec faltante, sin reporte JSON |
| `3` | Pre-flight BLOCKED: no se inicia la automatización; traces `BLOCKED` con causas |

El código de salida del proceso de Playwright es autoritativo. Si Playwright sale
con código distinto de `0` y **ningún** Test Case mapeado registra FAIL/SKIPPED
(por ejemplo, un error global o un rechazo no manejado mientras todos los tests
seleccionados pasan), la corrida se marca como `FAIL`: se agrega el mensaje a
registra `playwright_exit_code`. Un código distinto de `0` que sí queda explicado
por un FAIL/ERROR de datos o por un SKIPPED no genera un error de infraestructura
adicional (no se inventa una clasificación).

## 5. Artefactos por corrida (`<out>`)

| Archivo | Contenido | Contrato M-01 |
| --- | --- | --- |
| `execution_trace.json` | wrapper `{ suite_id, run_id, app, platform, traces[] }` | `execution-trace` (wrapper, `records_key: traces`) |
| `preflight_record.json` | registro completo del Pre-flight | `pre-flight-record` |
| `preflight.requirements.json` | requirements enviados al detector (trazabilidad) | — (operacional) |
| `results.raw.json` | salida cruda del JSON reporter de Playwright | — (operacional) |
| `summary.json` | resumen de la corrida (counters, duración, `playwright_exit_code`, `infrastructure_errors`) | — (operacional) |
| `junit.xml` | exportación JUnit XML de la corrida (solo con `--junit`; ver §5.1) | — (operacional; M-01 solo descubre `*.json`) |
| `evidence/<TC>/*` | evidencia promovida por TC (ver §6) | — |

Cada trace añade campos aditivos (permitidos por `additionalProperties` del
contrato): `test_case_id`, `title`, `status`, `app`, `platform`, `spec`,
`run_id`, `started_at`, `ended_at`, `assertions[]`, y en FAIL `error` + notes
"classification pending (Bug Analyst)".

```jsonc
{ "trace_id": "TR-R-20261009T162914957Z-TC-DEMO-WEB-1",
  "context": "TC-DEMO-WEB-1 Home renders the product catalog",
  "tool_requested": "runner:SUITE-demo-qaa-web:site.spec.ts:home renders the product catalog",
  "tool_executed": "runner:playwright:automation/specs/demo-web/site.spec.ts",
  "executed": true, "execution_success": true, "validation_performed": true,
  "status": "PASS", "test_case_id": "TC-DEMO-WEB-1", "app": "demo-qaa",
  "platform": "web", "spec": "automation/specs/demo-web/site.spec.ts",
  "started_at": "…", "ended_at": "…",
  "assertions": [ { "assertion": "…", "passed": true } ],
  "evidence": ["automation/.runs/suite-demo-web/evidence/TC-DEMO-WEB-1_assertions.json"],
  "confidence": "HIGH",
  "result_validated": "Validated against Expected Result with 11 assertion(s); evidence attached" }
```

### 5.1 JUnit XML (`--junit`, opcional)

Se genera **solo** si se pasa `--junit [path]` (default `<out>/junit.xml`) y se
deriva del mismo `ExecutionReport` que `report.json`/`report.html`; nunca
re-ejecuta, reinterpreta ni clasifica la corrida. Es un artefacto **operacional**
(como `report.html`): M-01 solo descubre `*.json`, así que no entra en el bundle.

| Modelo AGENTE-QAA | JUnit XML |
| --- | --- |
| `case.status = PASS` | `<testcase>` sin `failure`/`error`/`skipped` |
| `case.status = FAIL` | `<failure type="FAIL" message="…">` con el mensaje real; **no** es un Bug confirmado |
| `case.status = BLOCKED` | `<skipped message="BLOCKED: …">` (motivo del pre-flight) |
| `case.status = SKIPPED` | `<skipped message="…">` |
| `infrastructure_errors[]` | `<error type="INFRASTRUCTURE">` en un caso sintético `INFRASTRUCTURE-ERROR-n` (`classname="<suite>.suite-level"`) |
| `summary.errors` (data verification) | `<error type="DATA_VERIFICATION">` en casos sintéticos `DATA-VERIFICATION-ERROR-n` |
| `case.duration_ms` | `time` en segundos con 3 decimales |
| `run_id`, `report_id`, `app`, `platform`, `overall_status`, `preflight`, `auto_healing.*` | `<properties>` del `<testsuite>` |
| `test_case_id` + `title` | `name="<TC> <title>"`, `classname="<suite_id>"`, `file="<spec>"` |
| `case.evidence[]`, `case.auto_healing` | texto de `<system-out>` del caso |

Contadores derivados de los mismos datos: `tests` = casos + errores sintéticos;
`failures` = FAIL; `skipped` = BLOCKED + SKIPPED; `errors` = infraestructura +
data verification. Los casos sintéticos representan errores **de ejecución** de la
suite, nunca Test Cases de producto, y conservan la distinción PASS/FAIL/ERROR.

Los mensajes se escapan (`& < > " '`), se eliminan los caracteres inválidos para
XML 1.0 y los códigos ANSI que Playwright embebe en sus errores; los valores
ausentes se omiten (nunca se inventan).

## 6. Evidence

`<out>/evidence/<test_case_id>/` (PASS) y `…/` + `trace.zip` + screenshots (FAIL):

- La assertions log adjuntada por el spec se decodifica del JSON reporter
  (attachment `assertions.json` con `body` en base64) → `assertions.json` del TC.
- Las rutas en `evidence[]` son **repo-relativas** con `/`.
- PASS → log de assertions; FAIL → además screenshots/trace del intento fallido.

Los specs adjuntan evidencia vía `automation/runner/support.ts`:
`targetUrl()`, `recordAssertion(list, name, passed, detail?)`,
`attachAssertions(testInfo, list)`.

## 7. Reutilización (verificación real)

```bash
npm test
# → 68 passed (2 infra.smoke + 33 runner.infra + 8 junit + 25 sqlite-adapter)  [1 corrida, sin intervención IA]

npm run suite:demo-web
# pre-flight: READY
# 2 passed (2.1s)
# [PASS] TC-DEMO-WEB-1 · [PASS] TC-DEMO-WEB-2
# run R-20261009T162914957Z: 2 PASS / 0 FAIL / 0 SKIPPED (playwright exit 0)

npm run suite:demo-api
# pre-flight: READY · 2 passed
# [PASS] TC-DEMO-API-1 · [PASS] TC-DEMO-API-2
```

Validación M-01 sobre un directorio de corrida:

```bash
python qa/tools/validate_contracts.py --bundle automation/.runs/suite-demo-web --json
# valid: true · summary: artifacts 8 / records 3 / errors 0 / warnings 6
# (warnings solo para archivos operacionales sin contrato: manifest, summary, raw report)
```

Registros tomados de la corrida real `R-20261009T162914957Z`: trace
`TR-R-20261009T162914957Z-TC-DEMO-WEB-1` con 11 assertions PASS y
`result_validated: "Validated against Expected Result with 11 assertion(s);
evidence attached"`; evidencia en
`automation/.runs/suite-demo-web/evidence/TC-DEMO-WEB-1_assertions.json`.

El runner re-ejecuta **idéntico** resultado (mismos TCs, mismos status) sin
ninguna intervención de modelo — verificado en `runner.infra.spec.ts`
("reuse: a saved automation re-runs without AI intervention").

## 8. Pruebas de infraestructura (`automation/tests/runner.infra.spec.ts`, 33 tests)

1. Web PASS con asociación a `test_case_id` y evidence real.
2. API PASS (fixture `request` de Playwright, sin Axios/Newman).
3. Selección `--tc` corre solo el TC pedido.
4. Assertion fallida → FAIL trace con evidence, sin `failure_classification`.
5. Suite inexistente → exit 2.
6. Spec referencia inexistente → exit 2.
7. Pre-flight BLOCKED → exit 3, traces `BLOCKED`, sin `results.raw.json`.
8. Re-ejecución sin IA + artefactos validan con M-01.
9. Regresión: suites Python de M-01 (`test_validate_contracts.py`, 38/38) y
   M-04 (`test_preflight.py`, 48/48) siguen pasando.

Auto-healing (M-05), 6 tests adicionales:

10. `heal A` (TC-HEAL-12): suite `HIGH_CONFIDENCE` verde, traces enriquecidos y
    bundle valida con M-01.
11. `heal B`: el TC que falla por diseño sale con exit 1 y conserva el FAIL real
    con recuperación usada.
12. `heal C`: modo `OFF` verde; registra `NOT_ATTEMPTED`/`ORIGINAL_OK` y no lee ni
    escribe el store.
13. `heal D`: modo `OBSERVE` registra candidatos pero no lee ni escribe el store.
14. `heal E`: el mismo `--autoheal-store` entre corridas reutiliza la alternativa
    verificada sin IA.
15. `heal F` (TC-HEAL-13): una excepción en el sondeo del resultado no re-ejecuta
    la acción mutante recuperada.

M-02 (reportes), 8 tests adicionales:

16. `m02: report.json and report.html are generated and consistent`: ambos
    reportes se generan, son consistentes y el JSON valida con M-01.
17. `m02: HTML escapes dynamic content (no XSS)`: el HTML escapa `<script>`,
    `&` y comillas correctamente.
18. `m02: no secrets leak into reports`: no hay credenciales ni tokens en los
    reportes.
19. `m02: BLOCKED run generates report with BLOCKED status`: una corrida
    bloqueada por pre-flight genera reporte con estado `BLOCKED`.

20. `m02: duration_ms is computed from trace timestamps`: la duración se
    calcula a partir de los timestamps del trace.
21. `m02: duration_ms is 0 for missing or invalid timestamps`: sin
    timestamps válidos, `duration_ms` es 0.
22. `AUD-04: report.html resolves evidence links from its own directory`: los
    enlaces de evidencia del `report.html` se resuelven desde su propio directorio.
23. `AUD-04: missing evidence renders as a disabled (missing) link`: la
    evidencia ausente se muestra como enlace deshabilitado.

M-06 (verificación de datos SQLite, read-only), 7 tests adicionales:

24. `m06: suite with data verifications executes them and reflects results`:
    las verificaciones de datos declaradas se ejecutan y sus resultados se
    reflejan en el trace.
25. `m06: suite without data verifications works as before`: una suite sin
    verificaciones de datos no cambia su comportamiento previo.
26. `m06: write operations remain blocked through runner integration`: toda
    operación de escritura queda bloqueada también a través del runner.
27. `m06: error scenario - invalid database path produces ERROR status`: una
    ruta de base de datos inválida produce estado `ERROR`.
28. `m06: contract invalid rejection - invalid data_verification.json is
    rejected by M-01 validator`: un `data_verification.json` inválido es
    rechazado por el validador M-01.
29. `m06: runtime M-01 gate rejects an invalid data_verification artifact
    (invalid verification_id)`: el gate M-01 del runtime rechaza un artefacto
    con `verification_id` inválido.
30. `m06: association explicit test_case_id - TC-1 and TC-10 no
    cross-association`: la asociación explícita por `test_case_id` evita
    cruces entre TC-1 y TC-10.

> Los 33 tests son **infraestructura ejecutable** del runner; no son Test Cases de
> negocio. Los Test Cases de las suites de auto-healing son 12, declarados en los
> manifiestos `SUITE-heal-demo-*`.

Servidores demo aislados: `automation/scripts/serve-demo.mjs` (puerto 4173;
puertos 4176+ para TCs temporales). TCs FAIL/block usan manifiestos temporales
fuera del directorio de corrida para que el bundle M-01 no los descubra como
artefactos `test-case`.

## 9. Limitaciones

- El runner **no clasifica** FAIL (Bug Analyst). El auto-healing (M-05) solo
  selecciona locators y nunca clasifica ni altera el resultado real.
- Sin Cucumber/BDD, performance, mobile ni integraciones externas.
- Sin importación Postman/Swagger (M-09). El generador de reportes (M-02) se limita a `report.json` + `report.html` por corrida.
- M-06 (verificación de datos) soporta solo SQLite (`node:sqlite`), en modo read-only y con una sola sentencia `SELECT`/`WITH` por verificación.
- Un resultado solo se puede considerar validado si el trace lo declara con
  evidencia; el runner no corrige ni reinterpreta resultados.
- `--no-preflight` existe solo para depurar el runner; una corrida QA nunca lo
  usa.
- La señal del QA Reviewer es declarativa (M-04 la registra como tal); el
  runner no la convierte en comprobación real.
