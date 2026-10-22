# Runner de automatización (M-03) + Pre-flight (M-04) + Auto-healing (M-05) + Reportes (M-02)

Base técnica mínima y reproducible del **runner reutilizable** (M-03):
ejecuta Test Cases persistidos **sin tokens** con **Playwright Test** (Web + API)
y permanente **desacoplada del QA Core**: el Core (contratos, Failure
Classification, Evidence, QA Reviewer) sigue viviendo en Python + `docs/` + `qa/`.

Sobre esa base se apoyan el **Pre-flight ejecutable** (M-04, gate obligatorio
antes de cada corrida), el **auto-healing con guardrails** (M-05, recuperación
controlada de locators) y los **reportes de ejecución** (M-02, `report.json` +
`report.html` por corrida). Modos, límites y evidencia de M-05: `docs/AUTO-HEALING.md`.

> Las suites demo se ejecutan contra la **app local aislada**
> (`automation/fixtures/demo-app/` + servidor efímero en `127.0.0.1`), sin red
> externa ni credenciales. No hay simulaciones de ejecuciones exitosas: los
> PASS/FAIL provienen de assertions reales.

## Estructura

```
.
├─ package.json               # scripts (ver abajo) + dependencias
├─ package-lock.json          # árbol de dependencias fijado (npm ci)
├─ .nvmrc                     # versión objetivo de Node.js (24.21.0)
├─ .npmrc                     # engine-strict + save-exact (reproducibilidad)
├─ tsconfig.json              # type-check del código de automatización
├─ playwright.config.ts       # configuración Playwright base (npm test)
└─ automation/
   ├─ README.md               # este archivo
   ├─ .dist/                  # build del runner (tsc; ignorado, reproducible)
   ├─ runner/                 # código del runner M-03 + motor M-05 (TS)
   │  ├─ runner.ts            # CLI: manifest → pre-flight → Playwright → traces/evidence
   │  ├─ healed.ts            # motor M-05 de recuperación de locators (adapter Playwright)
   │  ├─ config.ts            # config Playwright del runner (JSON reporter → results.raw.json)
   │  ├─ support.ts           # helpers de specs: targetUrl(), recordAssertion(), attachAssertions()
   │  ├─ report.ts            # M-02: genera report.json + report.html por corrida
   │  ├─ junit.ts             # M-02 (adapter): exporta junit.xml desde el mismo ExecutionReport
   │  ├─ sqlite-adapter.ts    # M-06: adaptador SQLite read-only (node:sqlite)
   │  └─ tsconfig.json        # build NodeNext → automation/.dist
   ├─ manifests/              # suites: demo (SUITE-demo-qaa-web/api)
   │                          #         y auto-healing demo (SUITE-heal-demo-off/observe/hc/hc-fail)
   ├─ specs/                  # automatización por app (test() ↔ test_name del manifest)
   │  ├─ demo-web/site.spec.ts
   │  ├─ demo-api/api.spec.ts
   │  └─ heal-demo/           # M-05: off / observe / hc / hc-fail (.spec.ts)
   ├─ scripts/
   │  ├─ verify-env.mjs       # verificación del entorno (read-only)
   │  ├─ serve-demo.mjs       # servidor local demo (static + /api/*, stdlib, puerto 4173)
   │  └─ serve-heal-demo.mjs  # app demo M-05 (genera el HTML; puerto 4174)
   ├─ fixtures/
   │  ├─ hello.html           # fixture inicial de la prueba smoke
   │  └─ demo-app/index.html  # app demo (productos, carrito, data-testid)
   ├─ tests/                  # pruebas de infraestructura (NO son Test Cases de negocio)
   │  ├─ infra.smoke.spec.ts  # smoke base (web + api con servidor efímero)
   │  ├─ runner.infra.spec.ts # 33 tests seriales: M-03 + M-05 + M-02 (incl. JUnit) + M-06
   │  ├─ junit.spec.ts        # 8 tests unitarios del exportador JUnit XML (M-02)
   │  └─ sqlite-adapter.spec.ts # 25 tests M-06 (SQLite read-only)
   └─ .artifacts/             # salida de Playwright (ignorada; no es evidencia QA)
```

La automatización vive **fuera de `qa/`** a propósito: `qa/` contiene los
artefactos JSON validados por M-01 y no debe contaminarse con `node_modules`,
reportes ni archivos de configuración. Las corridas del runner por defecto
escriben en `automation/.runs/` (ignorado por git) — **fuera de `qa/`** — y se
validan individualmente con `--bundle <out>`; `--bundle qa` sigue descubriendo
solo los artefactos de negocio curados.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm ci` | Instala el árbol **exacto** del lockfile (reproducible). |
| `npm run verify:env` | Verifica runtime, dependencias, navegador y lockfile (read-only). |
| `npm run browsers:install` | Instala el navegador Chromium. |
| `npm run build:runner` | Compila el runner: `tsc -p automation/runner/tsconfig.json`. |
| `npm test` | `pretest` (build) + toda la suite de Playwright (2 smoke + 33 runner.infra + 8 junit + 25 sqlite-adapter = 68 tests en 4 archivos). |
| `npm run test:smoke` | Ejecuta solo la prueba técnica de infraestructura. |
| `npm run typecheck` | `tsc --noEmit` sobre config + specs + pruebas. |
| `npm run suite:demo-web` | Corrida demo Web sin IA (out: `automation/.runs/suite-demo-web`). |
| `npm run suite:demo-api` | Corrida demo API sin IA (out: `automation/.runs/suite-demo-api`). |
| `npm run suite -- --suite SUITE-heal-demo-off\|observe\|hc\|hc-fail [--autoheal-store <path>]` | Suites demo M-05; con `--autoheal-store` se comparte el store de reutilización entre corridas. |
| `npm run suite -- --suite <id> [--tc <id>] [--out <dir>] [--manifest <path>]` | Runner genérico (exit 0/1/2/3). |
| `npm run suite -- --suite <id> --junit [path]` | Además de `report.json`/`report.html`, exporta JUnit XML (default: `<out>/junit.xml`). Opt-in; no reemplaza los reportes existentes. |
| `npm run report` | Abre el reporte HTML generado. |

### Ejecuciones de proyectos externos

Para guardar resultados fuera del repositorio, separados por proyecto y ejecución:

```bash
npm run suite -- --suite <id> --out ../agente-qaa-runs/<projecto>/<ejecucion>
```

Ejemplo:

```bash
npm run suite -- --suite SUITE-demo-qaa-web --out ../agente-qaa-runs/demo-web/2026-10-14
```

> **Nota:** `--out` permite elegir el destino, pero no configura automáticamente ese comportamiento. Cada ejecución debe especificar la ruta deseada.

### JUnit XML (opcional)

```bash
npm run suite -- --suite SUITE-demo-qaa-web --junit
# → reports: automation/.runs/suite-demo-web/junit.xml

npm run suite -- --suite SUITE-demo-qaa-web --out ../runs/demo --junit ../runs/demo/junit.xml
```

`junit.xml` se deriva del mismo `ExecutionReport` que `report.json`/`report.html`:
PASS → `<testcase>`; FAIL → `<failure type="FAIL">` (sin clasificar); BLOCKED/SKIPPED
→ `<skipped>`; errores de ejecución → `<error>` en casos sintéticos `*.suite-level`.
No reemplaza los reportes existentes y no forma parte del bundle M-01 (solo
descubre `*.json`). Correspondencia completa: `docs/RUNNER-M03.md` §5.1.

Detalle del runner (manifiesto, exit codes, artefactos, evidence): ver
`docs/RUNNER-M03.md`.

> En Windows, si PowerShell bloquea `npm.ps1` por política de ejecución, invocá
> `npm.cmd` o usá `cmd /c npm ...`.

## Dependencias (justificadas)

Solo `devDependencies`; **no** hay dependencias de runtime.

| Dependencia | Versión | Justificación |
| --- | --- | --- |
| `@playwright/test` | `1.64.0` | Único motor de Web **y** API: el fixture `request` (APIRequestContext) cubre API/HTTP sin agregar Axios ni Newman. Incluye runner, trace, screenshots y reporte HTML/JSON. |
| `typescript` | `5.9.3` | Tipado estático para el runner reutilizable y `tsc --noEmit` como gate de calidad. Playwright transpila TS de forma nativa. |
| `@types/node` | `24.19.1` | Tipos de Node (alineados a la línea 24) para scripts, specs y configuración. |

No se agregó Cucumber/Newman/k6 ni ningún driver de BD externo (M-06 usa el módulo integrado `node:sqlite`): son capacidades de
etapas posteriores y **no son necesarias** para M-03.

## Estado

| Capacidad | Configurada | Verificada (ejecutada) |
| --- | --- | --- |
| Runtime Node.js 24.x | Sí (`.nvmrc`, `engines`) | Sí (`node -v` = v24.21.0) |
| npm reproducible | Sí (`package-lock.json`, `engine-strict`) | Sí (`npm ci`/`npm install` OK) |
| Playwright Test | Sí (`playwright.config.ts`) | Sí (`npm test` — 55 tests) |
| Navegador Chromium | Sí (`npm run browsers:install`) | Sí (lanzado en pruebas web) |
| Runner TS compilado | Sí (`build:runner`) | Sí (typecheck + corridas reales) |
| Suite Web (2 TC) | Sí (`SUITE-demo-qaa-web`) | Sí (2 PASS + evidence) |
| Suite API (2 TC) | Sí (`SUITE-demo-qaa-api`) | Sí (2 PASS + evidence) |
| Selección `--tc` | Sí | Sí (1 trace PASS) |
| FAIL sin clasificar + evidence | Sí | Sí (exit 1, trace FAIL, `failure_classification` ausente) |
| Suite/spec inexistente | Sí | Sí (exit 2) |
| Pre-flight BLOCKED (M-04) | Sí | Sí (exit 3, traces BLOCKED, sin raw report) |
| Re-ejecución sin IA + validación M-01 | Sí | Sí (traces idénticos; bundle `valid: true`) |
| Regresión M-01/M-04 (Python) | Sí | Sí (M-01 38/38 y M-04 48/48) |
| Type-check | Sí | Sí (`tsc --noEmit` OK) |
| Verificación de entorno | Sí (`verify:env`) | Sí (5/5) |
| Auto-healing (M-05) | Sí | Sí (`OFF`/`OBSERVE`/`HIGH_CONFIDENCE`; contrato `auto-heal-record`; **12 Test Cases** demo en manifiestos + la verificación de infraestructura `TC-HEAL-12`) |
| Firefox / WebKit | No | No |
| M-02 reportes (`report.json`/`report.html`) | Sí (contrato `execution-report`) | Sí (generados por corrida) |
| M-06 verificación de datos SQLite | Sí (`node:sqlite` read-only) | Sí (23 tests + integrado en el runner) |

Evidencia de corridas, exit codes y limitaciones: `docs/RUNNER-M03.md` y
`docs/AUTOMATION-ARCHITECTURE.md`.

## Variables de entorno

- `QAA_TARGET_URL` — target de la corrida; lo setea el runner (nunca se
  hardcodea en los specs; `support.targetUrl()` lo lee).
- `QAA_RUNNER_OUT` — directorio de corrida del runner (interno).
- `QAA_QA_REVIEWER_AVAILABLE` — señal **declarativa** del QA Reviewer para
  M-04 (el runner la registra tal cual; nunca como comprobación real).
- `QAA_AUTOHEAL_MODE`, `QAA_AUTOHEAL_STORE`, `QAA_AUTOHEAL_OUT`,
  `QAA_AUTOHEAL_RUN_ID`, `QAA_APP`, `QAA_SUITE_ID` — las setea el runner para el
  motor M-05 (`automation/runner/healed.ts`) según el manifiesto; no se editan a mano.
- Credenciales: solo desde variables del proceso, **nunca** versionadas
  (`.env` está en `.gitignore`), **nunca** impresas en logs ni en manifests.