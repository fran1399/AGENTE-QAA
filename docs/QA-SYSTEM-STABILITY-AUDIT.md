# QA System — Stability, Integration & Simplification Audit

| Campo | Valor |
| --- | --- |
| Fecha | 2026-10-10 |
| Tipo | Auditoría **read-only** (estabilidad, integración, simplicidad) |
| Base | QA Core + M-01 (contratos), M-03 (runner), M-04 (pre-flight), M-05 (auto-healing) |
| Alcance | Verificar que lo documentado **existe y funciona** contra el repo actual; detectar duplicaciones, complejidad y archivos temporales |
| Restricciones | No modificar código/contratos/agentes/skills/dependencias/config; no borrar archivos; no implementar M-02; no cambiar modelos |
| Única escritura | Este documento (`docs/QA-SYSTEM-STABILITY-AUDIT.md`) |
| Veredicto | **AUDIT COMPLETE** |

> Regla aplicada: **NO EVIDENCE = NO CONFIRMED RESULT**. Cada afirmación separa
> `esperado` / `observado` / `evidencia` / `conclusión` / `confianza`. Una
> capacidad documentada **no** se asume funcional: se contrasta con el árbol y,
> cuando aplica, con una ejecución de verificación no destructiva.

---

## 1. Alcance y método

### 1.1 Qué se auditó
Las 7 áreas de integración exigidas, más duplicaciones/complejidad, estabilidad y
pruebas, simplificación y archivos temporales:

1. Agents ↔ Skills
2. Delegaciones de `qa-lead`
3. Pre-flight (M-04) ↔ runner (M-03)
4. runner (M-03) ↔ Playwright
5. Auto-healing (M-05) ↔ persistencia (store)
6. Contratos / schemas / validador (M-01)
7. Evidencia / trazabilidad / reportes · QA Reviewer ↔ Risk Matrix · Manifest/docs

### 1.2 Cómo se verificó (herramientas y evidencia)
- Lectura directa del árbol real: `README.md`, `MANIFEST.json`, `opencode.json`,
  `.gitignore`, `.npmrc`, `.nvmrc`, `MCP.md`, `AGENTS.md`, `package.json`,
  `playwright.config.ts`, `tsconfig.json`.
- Lectura de `.opencode/agents/*.md` (8) y `.opencode/skills/*/SKILL.md` (12).
- Lectura de `docs/` (11 documentos) y de `qa/schema/*` (17 schemas + `index.json`).
- Lectura del código de automatización: `automation/runner/{runner,healed,support,config}.ts`,
  `automation/tests/*.spec.ts`, `automation/specs/**/*.spec.ts`, `automation/manifests/*.json`,
  `automation/scripts/*.mjs`.
- Lectura de artefactos QA reales: `qa/tests/dcshoes_*.json`, `qa/bugs/dcshoes_bugs.json`,
  `qa/reports/dcshoes_report.md`.
- Verificación **no destructiva** de conteos: `cmd /c npx playwright test --list`
  (solo listado, no ejecuta casos), comparación `MANIFEST.json` ↔ árbol con
  `Compare-Object`, y consulta de modelos con la herramienta de modelos de OpenCode.
- Inspección de directorios temporales: `automation/.runs/`, `automation/.artifacts/`,
  `automation/.dist/`, `qa/tools/__pycache__/`.

### 1.3 Qué NO se hizo (límites explícitos)
- No se re-ejecutó la batería completa: existe revisión de aceptación reciente de
  M-05 (mismo árbol) usada como **contexto de fondo**. Se priorizaron controles de
  bajo costo y alto valor (conteos, consistencia de inventario, integración de código).
- No se modificó ni borró nada. No hay Git (`Is directory a git repo: false`).
- Las cifras de pruebas de M-01/M-04/M-05 citadas aquí provienen de esa revisión
  previa; en esta auditoría solo se re-verificó el conteo de Playwright (17) y la
  consistencia estructural, no la verdad de la evidencia de negocio.

---

## 2. Resumen ejecutivo

**Estado general: sólido.** El sistema está bien integrado y la mayor parte de lo
documentado es real y ejecutable. **No se encontraron defectos funcionales
bloqueantes** dentro del alcance auditado. Los hallazgos son de **higiene,
consistencia documental y limpieza de temporales**, no de arquitectura.

- **Integraciones (7/7 verificadas):** Agents↔Skills, delegaciones de `qa-lead`,
  Pre-flight↔runner, runner↔Playwright, auto-healing↔store, contratos/schemas/validador
  y evidencia/trazabilidad/reportes están realmente conectadas (ver §3). Confianza **HIGH**.
- **Seguridad y privilegio mínimo:** los 8 agentes declaran `edit: deny` +
  `external_directory: deny` con `bash`/`task` acotados; solo `test-executor` puede
  ejecutar. MCP deshabilitado. Modelos verificados como existentes. Confianza **HIGH**.
- **Principal debilidad sistémica:** **deriva documental** (drift). Varios documentos
  declaran conteos/estados desactualizados (17 pruebas reales vs "11"; 12 TC-HEAL vs
  "13"; `automation/README.md` sin M-05). Es exactamente el riesgo que el propio Core
  vigila ("no asumir una capacidad por estar documentada") pero aplicado a sí mismo.
- **Temporales:** ~6.8 MB en `.runs/` + `.artifacts/` + `__pycache__` regenerables.
  Seguros de eliminar **tras backup** (no hay Git).

**Recomendación macro:** un pase de reconciliación docs↔árbol (F-01…F-05) + limpieza
de temporales (F-08) + dos ajustes de higiene (F-06, F-07). Todo de **riesgo bajo**.

---

## 3. Integraciones funcionales (verificación de las 7 áreas)

| # | Integración | Esperado | Observado (evidencia) | Conf. | Conclusión |
| --- | --- | --- | --- | --- | --- |
| 1 | Agents ↔ Skills | Cada agente referencia skills existentes | 8 agentes + 12 skills coexisten; los agentes citan `playwright-qa`, `api-testing`, `pre-flight`, `bug-analysis`, `contract-validation`, `retest`, `regression` (grep en `.opencode/agents/*.md`); las 12 carpetas existen en `.opencode/skills/` | HIGH | **OK** |
| 2 | Delegaciones `qa-lead` | Puede delegar en los 7 subagentes | `qa-lead.md` `permission.task.*` habilita `test-designer, exploratory-qa, risk-analyst, test-executor, test-data, bug-analyst, qa-reviewer`; `mode: primary`; los 7 archivos existen | HIGH | **OK** |
| 3 | Pre-flight ↔ runner | El runner ejecuta el detector M-04 como gate | `runner.ts:298-317` `runPreflight()` hace `spawn(python, [PREFLIGHT_PY, '--requirements', ..., '--json'])`, escribe `preflight_record.json`; `:811-823` si `!= READY` no ejecuta y sale con exit 3 | HIGH | **OK** |
| 4 | runner ↔ Playwright | Ejecuta specs por CLI con config propia | `runner.ts:379` `spawn(process.execPath, [PLAYWRIGHT_CLI, ...])`; `automation/runner/config.ts` define reporter JSON y `outputDir` desde `QAA_RUNNER_OUT`; `npm test` usa `playwright.config.ts` | HIGH | **OK** |
| 5 | Auto-healing ↔ persistencia | Store persistente reutilizable entre corridas | `runner.ts:354-366` inyecta `QAA_AUTOHEAL_MODE/STORE/OUT/RUN_ID/APP/SUITE_ID`; `:837` `enrichAutoHealing()`; `--autoheal-store` (`:210`) comparte store; verificado por test **heal E** ("same --autoheal-store across runs reuses the verified alternative") en `runner.infra.spec.ts:742` | HIGH | **OK** |
| 6 | Contratos/schemas/validador | Schema por contrato + registro + validador | `qa/schema/` tiene 17 schemas (16 contratos en `index.json`); incluye `execution-trace` (`index.json:19`) y `auto-heal-record` (`:20`); `AGENT-CONTRACTS.md:299,319` documenta ambos; validador `qa/tools/validate_contracts.py` + tests | HIGH | **OK** |
| 7 | Evidencia/trazabilidad/reportes + Reviewer↔Risk | Trazas por TC, evidencia, y Reviewer obligatorio en riesgo alto | `runner.ts` escribe `execution_trace.json` (`:818,:843`) y `summary.json` (`:640`); evidencia por TC en `<out>/evidence/`; `qa/reports/dcshoes_report.md` y `qa/bugs/dcshoes_bugs.json` existen; `reviewer-verdict`/`risk-record` en `index.json`; `qa-reviewer.md:28,46` audita heal | HIGH | **OK** |

### 3.1 Integración M-05 en el Core (no solo en el adapter)
Evidencia de que M-05 no se quedó "en el runner":
- Skill `pre-flight/SKILL.md:46,51-60` documenta `--autoheal-store` y los modos.
- Agente `test-executor.md:81-97` describe el auto-healing y su validación con el
  contrato `auto-heal-record`.
- Agente `qa-reviewer.md:28,46` exige comprobar que un heal no convierta FAIL en PASS.
- `AGENT-CONTRACTS.md:319` define el contrato y su invariante ("NEVER converts FAIL
  into PASS").

**Conclusión §3:** las integraciones están cableadas en código **y** en gobernanza.
Confianza **HIGH**.

---

## 4. Duplicaciones y complejidad

| ID | Elemento | Naturaleza | Evaluación |
| --- | --- | --- | --- |
| D-01 | `tests/` (raíz) vs `qa/tests/` | Doble ubicación declarada en `AGENTS.md` para "Test definitions/cases" | Posible ambigüedad. La raíz solo tiene `.gitkeep`. Ver F-07 |
| D-02 | `automation/specs/` vs `automation/tests/` | Ambos con `.spec.ts` | **No es duplicación real**: `tests/` = infraestructura del runner; `specs/` = Test Cases de negocio. Correcto |
| D-03 | `docs/RUNNER-M03.md` y `docs/PRE-FLIGHT-CAPABILITIES.md` | Solapamiento parcial (ambos describen el gate pre-flight) | Aceptable: uno es del runner, otro del detector. Bajo impacto |
| D-04 | Documento comparativo con un framework externo vs. el resto de `docs/` | Documento histórico con estados ya superados | Ver F-05 |

**Complejidad:** 8 agentes + 12 skills + 16 contratos es un conjunto coherente y
proporcional. El runner (`runner.ts` 874 líneas, `healed.ts` 917) es el componente
más grande pero está **desacoplado** del Core (Python + `qa/`). No se detectó
complejidad innecesaria; el "costo" real es de **mantenimiento documental** (drift),
no de diseño.

---

## 5. Clasificación de hallazgos (`KEEP` / `FIX` / `MERGE` / `DELETE` / `DEFER`)

### F-01 — Conteos de pruebas desactualizados en README
- **KEEP** la estructura documental; **FIX** los números.
- **Path/componente:** `README.md:58`, `automation/README.md:43,62,95`.
- **Evidencia:** `README.md:58` dice "npm test # 11 tests: 2 smoke + 9 runner infra";
  `automation/README.md:43` "# 9 tests M-03", `:62` "2 smoke + 9 M-03", `:95`
  "npm test — 11 tests". Verificación real: `npx playwright test --list` →
  **"Total: 17 tests in 2 files"** (2 smoke + 15 `runner.infra.spec.ts`).
- **Problema y consecuencias:** evidencia de verificación falsa-por-antigüedad;
  erosiona la confianza en el propio reporte de estado.
- **Recomendación:** actualizar a 17 (2 + 15).
- **Riesgo del cambio:** MUY BAJO (solo texto).
- **Pruebas requeridas:** ninguna funcional; opcional, control de consistencia docs↔conteo.

### F-02 — "13 TC demo" (M-05) vs 12 TC reales en manifiestos
- **FIX**.
- **Path/componente:** `docs/AUTO-HEALING.md:6`, `docs/AUTOMATION-ARCHITECTURE.md:125`.
- **Evidencia:** los 4 manifiestos heal definen **12** `test_case_id`
  (hc=8: TC-HEAL-2,3,4,6,7,8,11,13 · off=2: 1,9 · observe=1: 10; hc-fail=1: 5).
  **TC-HEAL-12** no está en ningún manifiesto: es la aserción de validación M-01 del
  bundle dentro de `runner.infra.spec.ts` (test "heal A … (TC-HEAL-12)").
- **Problema y consecuencias:** se cuenta una aserción de infraestructura como Test
  Case; afecta precisión de trazabilidad (no es un defecto funcional).
- **Recomendación:** redactar "12 TC demo + 1 verificación de contrato (TC-HEAL-12)"
  o mover TC-HEAL-12 al contrato de casos si se desea contarlo como TC.
- **Riesgo del cambio:** MUY BAJO.
- **Pruebas requeridas:** ninguna; verificación de conteo de `test_case_id`.

### F-03 — `automation/README.md` no refleja M-05 ni el árbol actual
- **FIX**.
- **Path/componente:** `automation/README.md` (bloque "Estructura" líneas 15-45,
  "Comandos" 54-68, encabezado línea 1).
- **Evidencia:** el árbol lista `healed.ts`, `automation/specs/heal-demo/*.spec.ts`,
  `automation/manifests/SUITE-heal-demo-*.json`, `automation/scripts/serve-heal-demo.mjs`;
  el README **no** los menciona, no documenta `--autoheal-store` ni las variables
  `QAA_AUTOHEAL_*`, y su título dice "Runner de automatización (M-03) + base técnica".
  Sí incluye M-05 en la tabla de Estado (`:108`), por lo que la omisión es de detalle.
- **Problema y consecuencias:** onboarding incompleto; capacidad M-05 "invisible" en el
  doc de entrada a `automation/`.
- **Recomendación:** añadir estructura heal + `--autoheal-store` + `QAA_AUTOHEAL_*`
  y renombrar el encabezado para incluir M-04/M-05.
- **Riesgo del cambio:** MUY BAJO.
- **Pruebas requeridas:** ninguna funcional.

### F-03b — Header/estructura: ver también `README.md` §Automation
- **FIX** (bajo impacto). `README.md:43,71-73` menciona M-03 y docs; el bloque de
  comandos (`:58`) ya citado en F-01.

### F-04 — `MANIFEST.json`: separadores Windows y omisión de artefactos de negocio
- **FIX** (parcial); **KEEP** el resto.
- **Path/componente:** `MANIFEST.json`.
- **Evidencia:** versión `1.6.0-core`, 144 entradas, **todas presentes** en el árbol
  (`Compare-Object` → 0 fantasma). Usa separadores `\\` (p. ej. `.opencode\\agents\\qa-lead.md`),
  no portables. El árbol tiene **158** archivos: 14 extra (evidencia DC Shoes, `dcshoes_*_bug/report/tests`)
  no listados.
- **Problema y consecuencias:** (a) rutas no portables fuera de Windows; (b) completitud
  ambigua: ¿"Core" excluye deliberadamente los artefactos runtime o es un olvido?
- **Recomendación:** normalizar a `/` y documentar explícitamente la política de inclusión
  (Core vs artefactos de negocio) o listarlos.
- **Riesgo del cambio:** BAJO (documento de inventario; no lo consume el runtime).
- **Pruebas requeridas:** opcional, verificación de que cada ruta del manifest existe.

### F-05 — Documento comparativo externo desactualizado (histórico)
- **KEEP** como histórico + **FIX** nota de estado. (No DELETE: es la justificación
  metodológica de las etapas M-01…M-05.)
- **Path/componente:** documento comparativo con un framework externo (fechado 2026-10-09).
- **Evidencia:** `:66` "MANIFEST.json (version 1.1.0-core, 34 archivos)"; `:70`
  "11 skills"; `:167` marco de automatización **AUSENTE**; `:320` M-05 tratado como
  pendiente. Hoy: **1.6.0-core / 144**, **12 skills**, M-03/M-04/M-05 **IMPLEMENTADOS**.
  El mismo archivo se contradice (`:282,:320`).
- **Problema y consecuencias:** un lector nuevo puede concluir un estado erróneo.
- **Recomendación:** encabezado "SUPERSEDED por M-01…M-05 (ver docs/AUTOMATION-ARCHITECTURE.md)";
  no borrar.
- **Riesgo del cambio:** MUY BAJO.
- **Pruebas requeridas:** ninguna.

### F-06 — `.gitignore` sin patrones de Python
- **FIX**.
- **Path/componente:** `.gitignore`; artefacto `qa/tools/__pycache__/validate_contracts.cpython-312.pyc`.
- **Evidencia:** `.gitignore` ignora `node_modules/`, `.dist/`, `.runs/`, `.artifacts/`,
  `*.tsbuildinfo`, `.env*`, pero **no** `__pycache__/` ni `*.pyc`; el `.pyc` existe y
  **no** está en `MANIFEST.json`.
- **Problema y consecuencias:** riesgo de commitear bytecode; ruido en el inventario.
- **Recomendación:** añadir `__pycache__/` y `*.pyc`.
- **Riesgo del cambio:** MUY BAJO.
- **Pruebas requeridas:** ninguna.

### F-07 — Doble ubicación de Test Cases (`tests/` raíz vs `qa/tests/`)
- **MERGE/DECIDE** (por ahora **DEFER**): requiere decisión de contrato, no cambio unilateral.
- **Path/componente:** `AGENTS.md` (layout), `tests/.gitkeep`, `qa/tests/.gitkeep`.
- **Evidencia:** `AGENTS.md` declara `tests/` (raíz) para "Test definitions/cases" y
  `qa/tests/` para "QA-owned test artifacts". La raíz solo contiene `.gitkeep`; todos
  los Test Cases reales viven en `qa/tests/`.
- **Problema y consecuencias:** ambigüedad sobre dónde poner/leer casos.
- **Recomendación:** documentar la distinción en `AGENTS.md`/`qa/README.md` o retirar el
  placeholder raíz. No borrar sin actualizar el contrato de layout.
- **Riesgo del cambio:** BAJO pero **condicionado a decisión**.
- **Pruebas requeridas:** ninguna funcional.

### F-08 — Temporales regenerables (ver plan de backup en §8)
- **DELETE** (solo tras backup).
- **Path/componente:** `automation/.runs/` (19 dirs, **310** archivos, **5.07 MB**),
  `automation/.artifacts/` (`accept` 51/373 KB, `accept-review` 71/1.29 MB, `m03` 0,
  `runner-out`, `test-results`, `playwright-report`), `automation/.dist/` (4 archivos),
  `qa/tools/__pycache__/`.
- **Evidencia:** todos ignorados por `.gitignore` salvo `__pycache__`; reproducibles
  por `npm run build:runner` y `npm run suite*`. Además son **artefactos locales no
  distribuidos** (ver nota de distribución en §8.1): no existen en un clon limpio.
- **Problema y consecuencias:** ruido de workspace (~6.8 MB); ninguno funcional.
- **Recomendación:** backup (§8) y luego limpieza; añadir `__pycache__` a `.gitignore` (F-06).
- **Riesgo del cambio:** BAJO (regenerable).
- **Pruebas requeridas:** tras limpiar, `npm run build:runner` + `npm test` (o `--list`)
  para confirmar que nada depende de esos directorios.

### F-09 — Integridad de scripts/dependencias (sin huérfanos)
- **KEEP**.
- **Evidencia:** todos los scripts de `package.json` resuelven a archivos existentes;
  `MANIFEST.json` sin entradas fantasma; solo 3 `devDependencies`
  (`@playwright/test`, `typescript`, `@types/node`), todas justificadas y usadas.
- **Conclusión:** sin código muerto detectado. Confianza **HIGH**.

### F-10 — Privilegio mínimo y modelos
- **KEEP**.
- **Evidencia:** los 8 agentes tienen `edit: deny`, `external_directory: deny`,
  `permission: yes`; `test-executor` es el único con comandos de ejecución;
  `qa-reviewer` no tiene ejecución. Modelos de `AGENTS.md` verificados como existentes
  (`nemotron-3-ultra-free`, `mimo-v2.6-flash-free`, `longcat-2.5-preview-free`,
  `nemotron-3.5-lightning-free`) y coincidentes con los `model:` de cada agente. MCP
  con `context7` en `enabled:false`.
- **Conclusión:** política de seguridad efectiva. Confianza **HIGH**.

### F-11 — Sin verificación automática de frescura documental
- **DEFER** (fuera de alcance actual).
- **Evidencia:** F-01…F-05 existen porque nada compara docs con el árbol; no hay CI.
- **Recomendación:** a futuro, un chequeo barato (p. ej. contar `test()` en specs vs
  README) como parte de la suite. No implementar en esta auditoría.

---

## 6. Estabilidad y pruebas

| Suite | Comando | Conteo/estado | Fuente |
| --- | --- | --- | --- |
| Playwright (infra) | `npm test` | **17** (2 smoke + 15 runner infra) | Verificado en esta auditoría (`--list`) |
| Contratos M-01 | `python qa/tools/test_validate_contracts.py` | 35 OK | Revisión previa M-05 (contexto) |
| Pre-flight M-04 | `python qa/tools/test_preflight.py` | 48 OK | Revisión previa M-05 (contexto) |
| Type-check | `npm run typecheck` | exit 0 | Revisión previa M-05 (contexto) |
| Build runner | `tsc -p automation/runner/tsconfig.json` | exit 0 | Revisión previa M-05 (contexto) |

**Estabilidad observada:**
- El runner conserva trazabilidad ante pre-flight BLOCKED (test dedicado) y no arranca
  automatización; exit codes 0/1/2/3 documentados y cubiertos.
- M-05 tiene cobertura fuerte: modos OFF/OBSERVE/HIGH_CONFIDENCE, preservación de FAIL,
  reutilización por store, guardrail de acción mutante (TC-HEAL-13) y validación M-01
  del bundle (TC-HEAL-12).
- **Limitaciones conocidas a mantener** (del contexto previo, no re-verificadas aquí):
  la ausencia de lectura del store no es observable dinámicamente; DC Shoes depende de
  un sitio externo en vivo; el store HC termina con entradas `STALE` por diseño.

**Riesgo de estabilidad:** BAJO. El único riesgo sistémico es de **gobernanza
documental** (F-01…F-05), no de ejecución.

---

## 7. Simplificación

Oportunidades ordenadas por relación valor/riesgo (ninguna toca la arquitectura):

1. **Reconciliación documental (F-01, F-02, F-03, F-05):** una sola pasada alinea
   README root, `automation/README.md`, `AUTO-HEALING.md`, `AUTOMATION-ARCHITECTURE.md`
  y marca el documento comparativo externo como histórico. Máximo valor, riesgo mínimo.
- **Higiene (F-06):** una línea en `.gitignore`.
- **Limpieza (F-08):** elimina ~6.8 MB y decenas de directorios de corridas; sin efecto
  funcional porque son reproducibles.
- **Manifest (F-04):** normalizar rutas y aclarar política de inclusión.
- **No simplificar:** la estructura de agentes/skills, el runner y los contratos están
  bien dimensionados; `automation/specs` vs `automation/tests` es separación correcta.

---

## 8. Archivos temporales y plan de backup (sin Git)

**Contexto crítico:** el repositorio **no** está bajo Git (`Is directory a git repo: false`).
Por lo tanto **ninguna eliminación es reversible por VCS**. Antes de cualquier borrado
propuesto (F-08) debe existir un backup verificable.

### 8.1 Inventario de temporales (medido)

| Directorio | Archivos | Tamaño | Ignorado por `.gitignore` | Regenerable |
| --- | --- | --- | --- | --- |
| `automation/.runs/` | 310 | 5.07 MB | Sí (`automation/.runs/`) | Sí (`npm run suite*`) |
| `automation/.artifacts/accept/` | 51 | 373 KB | Sí (`automation/.artifacts/`) | Sí (re-ejecución) |
| `automation/.artifacts/accept-review/` | 71 | 1.29 MB | Sí | Sí (re-ejecución) |
| `automation/.artifacts/m03/` | 0 | 0 | Sí | Sí |
| `automation/.artifacts/runner-out/` | 1 | 4.4 KB | Sí | Sí |
| `automation/.artifacts/test-results/` | 1 | 45 B | Sí | Sí |
| `automation/.dist/` | 4 | — | Sí (`automation/.dist/`) | Sí (`npm run build:runner`) |
| `qa/tools/__pycache__/` | 1 | — | **No** | Sí (importar `validate_contracts`) |

> **Nota de distribución (2026-10-12):** los directorios inventariados en §8.1
> (`automation/.runs/`, `automation/.artifacts/`, `automation/.dist/`, `__pycache__/`) son
> **artefactos locales** del entorno de esta auditoría, excluidos por `.gitignore`; **no se
> distribuyen** con el repositorio y **no existen en un clon limpio**. Son **regenerables**
> (`npm run build:runner`, `npm run suite*`) y ninguna conclusión de este informe depende de su
> presencia. La ruta de backup citada en §8.2 (`%TEMP%\opencode\...`) es local del entorno, no una
> ruta del repositorio.

### 8.2 Plan de backup (verificable, sin Git)
1. **Congelar**: confirmar que no hay corridas activas.
2. **Copiar** (no mover) los directorios a un destino fuera del repo, con timestamp:
   `%TEMP%\opencode\qaa-audit-backup-2026-10-10\` →
   `.runs/`, `.artifacts/`, `.dist/`, `__pycache__/` (conservar la estructura relativa).
3. **Verificar el backup**: comparar conteo de archivos y suma de bytes origen↔copia
   (`Get-ChildItem -Recurse | Measure-Object`). Debe coincidir exactamente.
4. **Registrar** en este documento (o en `qa/memory/`) la ruta del backup, la fecha y
   los conteos, como evidencia.
5. **Recién entonces** eliminar los directorios de trabajo (§8.1).
6. **Post-limpieza**: `npm run build:runner` y `npm test -- --list` (o `npm test`) para
   confirmar que el sistema reconstruye todo sin depender de los temporales.

> Alternativa recomendada a mediano plazo: inicializar Git para que la limpieza y los
> cambios documentales sean reversibles. Fuera del alcance de esta auditoría read-only.

---

## 8bis. Evidencia de la comparación de inventario

Verificación ejecutada (no destructiva):

```
ACTUAL_FILES=158  MANIFEST_FILES=144
--- IN TREE BUT NOT IN MANIFEST ---
qa\bugs\dcshoes_bugs.json
qa\evidence\dcshoes\*.png            (9 archivos)
qa\reports\dcshoes_report.md
qa\tests\dcshoes_execution_trace.json
qa\tests\dcshoes_risk.json
qa\tests\dcshoes_tc.json
--- IN MANIFEST BUT NOT IN TREE ---
(vacío)
```

Conteo Playwright:

```
Total: 17 tests in 2 files
```

---

## 9. Entregable y cierre

### 9.1 Hallazgos principales
1. **Integraciones 7/7 reales y cableadas** (código + gobernanza). Confianza HIGH.
2. **Drift documental** es el único riesgo sistémico: 17 pruebas reales vs "11";
   12 TC-HEAL vs "13"; `automation/README.md` sin M-05; documento comparativo externo superado.
3. **Sin defectos funcionales ni código muerto**; scripts y dependencias íntegros.
4. **Privilegio mínimo y modelos** correctos; MCP deshabilitado.
5. **~6.8 MB de temporales regenerables**; limpieza segura solo con backup (sin Git).

### 9.2 Top 5 acciones (riesgo bajo, ordenadas por valor)
1. **Reconciliar conteos y estados en docs** (F-01, F-02, F-03): README raíz,
   `automation/README.md`, `AUTO-HEALING.md`, `AUTOMATION-ARCHITECTURE.md`.
2. **Marcar el documento comparativo externo como histórico/superado** (F-05).
3. **Endurecer `.gitignore`** con `__pycache__/` y `*.pyc` (F-06).
4. **Backup verificado y limpieza de temporales** `.runs/` + `.artifacts/` + `.dist/`
   + `__pycache__/` (F-08, §8).
5. **Normalizar `MANIFEST.json`** (rutas `/`) y decidir/documentar la inclusión de
   artefactos de negocio (F-04); documentar/decidir `tests/` raíz (F-07).

### 9.3 Report path
- `docs/QA-SYSTEM-STABILITY-AUDIT.md` (este documento).

### 9.4 Estado final
**AUDIT COMPLETE**

---

## Anexo A — Matriz de trazabilidad hallazgo → acción → prueba

| Hallazgo | Tipo | Acción | Prueba de verificación |
| --- | --- | --- | --- |
| F-01 | FIX | Actualizar conteos a 17 | `npx playwright test --list` |
| F-02 | FIX | Aclarar 12 TC + TC-HEAL-12 | conteo `test_case_id` en manifiestos heal |
| F-03 | FIX | Completar README de automation | inspección de estructura |
| F-04 | FIX | Rutas `/` + política de inclusión | comparación manifest↔árbol |
| F-05 | KEEP+FIX | Nota "superseded" | inspección documental |
| F-06 | FIX | `.gitignore` + `__pycache__/` | `git check-ignore` (cuando exista Git) |
| F-07 | MERGE/DEFER | Decidir ubicación de Test Cases | actualizar `AGENTS.md`/`qa/README.md` |
| F-08 | DELETE | Backup + limpieza | `npm run build:runner` + `npm test` |
| F-09 | KEEP | — | resolución de scripts |
| F-10 | KEEP | — | permisos de agentes + modelos |
| F-11 | DEFER | Chequeo de frescura (futuro) | — |

## Anexo B — Declaración de no modificación
Salvo la creación de este documento, la auditoría no alteró ningún archivo,
contrato, agente, skill, dependencia ni configuración, y no eliminó archivos.
Las operaciones de verificación fueron de solo lectura (`--list`, lectura de
archivos, `Compare-Object`, consulta de modelos).
